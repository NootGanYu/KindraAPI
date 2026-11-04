import vm from 'node:vm'
import type { AssertionResult, ConsoleEntry, FlowResponseSnapshot } from '@shared/types'

interface State {
 environment: Record<string, unknown>
 globals: Record<string, unknown>
 local: Record<string, unknown>
 response: FlowResponseSnapshot | null
}
interface Output extends State { observed: string[]; assertions: AssertionResult[]; console: ConsoleEntry[]; ok?: boolean; error?: string }

/** Only JSON text crosses the VM boundary. All objects, intrinsics and callbacks are created
 * in the context; host functions (including console and constructors) are never injected.
 * Return JSON is produced under the same timeout, never inspected/coerced in the host. */
export function isolatedScript(state: State, code: string, condition = false): Output {
 const bootstrap = `
 const state = JSON.parse(${JSON.stringify(JSON.stringify(state))});
 const assertions = [], logs = [], observed = [];
 const stringify = JSON.stringify.bind(JSON);
 const vars = state.local, env = state.environment, globals = state.globals, response = state.response;
 const bag = values => ({ get: key => Object.hasOwn(values, key) ? values[key] : undefined,
  set: (key, value) => { const text = String(value ?? ''); observed.push(text); Object.defineProperty(values, String(key), {value: text, writable: true, enumerable: true, configurable: true}) },
  unset: key => { delete values[key] } });
 const log = level => (...args) => logs.push({time: Date.now(), level, args: args.map(a => typeof a === 'string' ? a : stringify(a))});
 const console = {log: log('log'), info: log('info'), warn: log('warn'), error: log('error')};
 const expect = actual => {
  const check = (test, name) => { if (!test) throw Error('断言失败: ' + name) };
  const tests = {
   eql: value => stringify(actual) === stringify(value), equal: value => actual == value,
   above: value => Number(actual) > Number(value), below: value => Number(actual) < Number(value),
   least: value => Number(actual) >= Number(value), most: value => Number(actual) <= Number(value),
   include: value => typeof actual === 'string' || Array.isArray(actual) ? actual.includes(value) : false,
   a: value => typeof actual === value, match: value => new RegExp(value).test(String(actual)),
   length: value => actual?.length === Number(value)
  };
  tests.equals = tests.eql; tests.contains = tests.include;
  const make = negate => {
   const result = {};
   for (const [name, test] of Object.entries(tests)) result[name] = value => {check(negate ? !test(value) : test(value), name); return result};
   for (const [name, test] of Object.entries({true: () => actual === true, false: () => actual === false, ok: () => !!actual, exist: () => actual != null})) Object.defineProperty(result, name, {get: () => {check(negate ? !test() : test(), name); return result}});
   for (const key of ['to','be','have','and']) result[key] = result;
   return result;
  };
  const positive = make(false), negative = make(true); positive.not = negative; negative.not = positive; return positive;
 };
 const pm = {environment: bag(env), globals: bag(globals), variables: {...bag(vars), get: key => Object.hasOwn(vars,key) ? vars[key] : Object.hasOwn(env,key) ? env[key] : globals[key]},
  response: response ? {...response, text: () => response.body, json: () => JSON.parse(response.body), headers: {get: name => response.headers[Object.keys(response.headers).find(key => key.toLowerCase() === String(name).toLowerCase())]}} : undefined,
  expect, info: console.info, test: (name, fn) => {try {fn(); assertions.push({name: String(name), passed: true})} catch(e) {assertions.push({name: String(name), passed: false, error: String(e?.message ?? e)})}}
 };
 let ok, error;
 try { ${condition ? `ok = Boolean((${code}));` : `(() => { ${code}\n })();`} } catch(e) { error = String(e?.message ?? e) }
 stringify({...state, observed, assertions, console: logs, ok, error});`
 try {
  const output = vm.runInNewContext(bootstrap, Object.create(null), { timeout: condition ? 500 : 3000, contextCodeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate', filename: 'approved-flow.js' })
  if (typeof output !== 'string') throw new Error('Invalid script result')
  return JSON.parse(output) as Output
 } catch {
  // Never read properties on a thrown context object: they can contain untrusted getters.
  return { ...state, observed: [], assertions: [], console: [], error: 'Flow 脚本或条件无效、超时或使用了受限能力' }
 }
}
