import crypto from 'node:crypto';
import type { Environment, FlowEvent, FlowRefreshConflict, FlowRefreshPreview, FlowRefreshReference, FlowRequestInput, FlowVersionSwitch, Target } from '@shared/types';
import { createId } from '@shared/factories';
import * as store from '../storage/store';
import { captureRequestDefinition, type RequestExecutionDefinition } from '../request/executor';
import { redactEvidence } from './evidence';
export const definitionRevision = (definition: RequestExecutionDefinition): string => crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface Candidate {
    event: FlowEvent;
    raw: Target;
    definition: RequestExecutionDefinition;
    apiRevision: string;
    reference: FlowRefreshReference;
}
/** In-memory definitions and review state; public evidence is always projected before leaving this module. */
export class FlowRefreshController {
    private originals = new Map<string, Target>();
    private pending?: {
        preview: FlowRefreshPreview;
        candidates: Candidate[];
    };
    private reviewed?: Candidate[];
    constructor(private projectId: string, private environment: Environment | null, private definitions: Map<string, RequestExecutionDefinition>, private remaining: () => Array<{
        event: FlowEvent;
        count: number;
    }>, private applyInput: (target: Target, input?: FlowRequestInput) => Target, private variables: () => Record<string, string>, events: FlowEvent[], private position: () => string | undefined) {
        const capture = (items: FlowEvent[]): void => {
            for (const event of items) {
                if (event.target_id) {
                    const target = store.getTarget(projectId, event.target_id);
                    if (target)
                        this.originals.set(event.event_id, clone(target));
                }
                capture(event.children ?? []);
            }
        };
        capture(events);
    }
    preview(): FlowRefreshPreview {
        const preview: FlowRefreshPreview = { preview_id: createId('review'), created_at: Date.now(), references: [], blockers: [] };
        const candidates: Candidate[] = [];
        for (const { event, count } of this.remaining()) {
            if (event.type !== 'api' || !event.target_id)
                continue;
            const current = store.readTargetSnapshot(this.projectId, event.target_id);
            const previous = this.definitions.get(event.event_id);
            if (!current.target || !current.revision || !previous) {
                preview.blockers.push(`接口已删除或不存在：${event.name}`);
                continue;
            }
            try {
                const definition = captureRequestDefinition(this.projectId, this.applyInput(current.target, event.input), this.environment);
                if (definitionRevision(definition) === definitionRevision(previous) && JSON.stringify(current.target) === JSON.stringify(this.originals.get(event.event_id)))
                    continue;
                const conflicts = this.conflicts(event, this.originals.get(event.event_id)!, current.target);
                const scope_changes = this.scopeChanges(previous, definition);
                const effective_request = this.effective(definition);
                const reference: FlowRefreshReference = { event_id: event.event_id, target_id: event.target_id, name: event.name, remaining_instances: count,
                    previous_revision: definitionRevision(previous), next_revision: definitionRevision(definition), api_revision: current.revision, effective_request, conflicts, scope_changes };
                preview.references.push(reference);
                candidates.push({ event, raw: clone(current.target), definition, apiRevision: current.revision, reference });
                if (conflicts.length)
                    preview.blockers.push(`${event.name} 存在步骤覆盖冲突，需逐项审阅`);
                if (scope_changes.length)
                    preview.blockers.push(`${event.name} 执行范围扩大，需明确审阅确认`);
            }
            catch (error) {
                preview.blockers.push(`${event.name}：${(error as Error).message}`);
            }
        }
        this.pending = { preview, candidates };
        return redactEvidence(clone(preview), [this.variables()]);
    }
    apply(previewId: string): FlowVersionSwitch {
        if (!this.pending || this.pending.preview.preview_id !== previewId)
            throw new Error('预览已失效，请重新审阅');
        if (this.pending.preview.blockers.length)
            throw new Error(this.pending.preview.blockers.join('；'));
        this.validate(this.pending.candidates);
        for (const item of this.pending.candidates) {
            this.definitions.set(item.event.event_id, item.definition);
            this.originals.set(item.event.event_id, item.raw);
        }
        this.reviewed = this.pending.candidates;
        return redactEvidence({ after_instance_id: this.position(), preview_id: previewId, applied_at: Date.now(), references: clone(this.pending.preview.references) }, [this.variables()]);
    }
    validateResume(): void {
        if (this.pending && this.pending.preview.blockers.length)
            throw new Error(this.pending.preview.blockers.join('；'));
        if (this.pending && this.pending.candidates.length && this.reviewed !== this.pending.candidates)
            throw new Error('请先采用已审阅的剩余引用更新');
        if (this.reviewed)
            this.validate(this.reviewed);
        // A deleted API is never silently resumed even when the user keeps the original snapshot.
        for (const { event } of this.remaining())
            if (event.target_id && !store.getTarget(this.projectId, event.target_id))
                throw new Error('接口已删除，请保持暂停并重新审阅');
    }
    private validate(candidates: Candidate[]): void {
        for (const item of candidates) {
            const current = store.readTargetSnapshot(this.projectId, item.event.target_id!);
            if (!current.target || current.revision !== item.apiRevision)
                throw new Error('接口 revision 已变化或被删除，请重新审阅');
            const captured = captureRequestDefinition(this.projectId, this.applyInput(current.target, item.event.input), this.environment);
            if (definitionRevision(captured) !== definitionRevision(item.definition))
                throw new Error('继承、模型或文件定义已变化，请重新审阅');
            this.effective(item.definition, true);
        }
    }
    private effective(definition: RequestExecutionDefinition, validate = false): FlowRefreshReference['effective_request'] {
        const vars = this.variables();
        const replace = (text: string): string => text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, key) => {
            if (vars[key] !== undefined)
                return vars[key];
            if (key === 'baseUrl')
                return definition.resolved.baseUrl;
            if (key.startsWith('$'))
                return all;
            if (validate)
                throw new Error(`缺少运行变量 ${key}，无法满足剩余请求前置条件`);
            return all;
        });
        const r = definition.resolved;
        const substitute = (value: unknown): unknown => typeof value === 'string' ? replace(value) : Array.isArray(value) ? value.map(substitute) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)])) : value;
        return substitute({ method: r.method, url: r.url, headers: r.headers, body: r.body }) as FlowRefreshReference['effective_request'];
    }
    private conflicts(event: FlowEvent, old: Target, current: Target): FlowRefreshConflict[] {
        const conflicts: FlowRefreshConflict[] = [];
        for (const [inputKey, requestKey] of [['query', 'query'], ['headers', 'header'], ['path', 'restful'], ['cookies', 'cookie']] as const) {
            for (const [key, override] of Object.entries(event.input?.[inputKey] ?? {})) {
                const value = (target: Target) => target.request?.[requestKey]?.parameter.find(p => inputKey === 'headers' ? p.key.toLowerCase() === key.toLowerCase() : p.key === key);
                const before = value(old), after = value(current);
                if (JSON.stringify(before) !== JSON.stringify(after))
                    conflicts.push({ event_id: event.event_id, field: `${inputKey}.${key}`, old_value: before?.value, new_value: after?.value, override_value: override });
            }
        }
        if (event.input?.body !== undefined && JSON.stringify(old.request?.body) !== JSON.stringify(current.request?.body))
            conflicts.push({ event_id: event.event_id, field: 'body', old_value: old.request?.body, new_value: current.request?.body, override_value: event.input.body });
        return conflicts;
    }
    private scopeChanges(before: RequestExecutionDefinition, after: RequestExecutionDefinition): string[] {
        const changes: string[] = [];
        const old = this.effective(before), next = this.effective(after);
        if (old.method !== next.method)
            changes.push(`method: ${old.method} → ${next.method}`);
        const origin = (url: string) => { try {
            return new URL(url).origin;
        }
        catch {
            return url;
        } };
        if (origin(old.url) !== origin(next.url))
            changes.push(`origin: ${origin(old.url)} → ${origin(next.url)}`);
        if (JSON.stringify([before.target.request?.pre_script, before.target.request?.pre_script_enabled, before.target.request?.test, before.target.request?.test_enabled]) !== JSON.stringify([after.target.request?.pre_script, after.target.request?.pre_script_enabled, after.target.request?.test, after.target.request?.test_enabled]))
            changes.push('脚本定义变化');
        if (after.files.some(file => !before.files.some(old => old.path === file.path && old.sha256 === file.sha256)))
            changes.push('文件范围或内容变化');
        return changes;
    }
}
