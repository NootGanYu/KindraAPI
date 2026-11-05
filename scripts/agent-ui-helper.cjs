/** Shared Playwright helpers for the always-mounted Agent dock. */
const permissionLabels = { ask: '询问权限', auto: '自动模式', bypass: '跳过权限' }

async function openAgentPanel(page) {
  const panel = page.locator('.agent-dock-panel')
  if (await panel.isVisible().catch(() => false)) return panel
  const fab = page.getByRole('button', { name: '打开 Agent' })
  await fab.waitFor()
  await fab.click()
  await panel.waitFor()
  return panel
}

async function closeAgentPanel(page) {
  const panel = page.locator('.agent-dock-panel')
  if (!(await panel.isVisible().catch(() => false))) return
  await page.getByRole('button', { name: '收起面板' }).click()
  await panel.waitFor({ state: 'hidden' })
}

async function submitAgentGoal(page, goal) {
  const panel = await openAgentPanel(page)
  await page.getByRole('textbox', { name: '告诉 Agent 要做什么' }).fill(goal)
  await panel.locator('.agent-compose').getByRole('button', { name: /发送/ }).click()
}

async function selectPermissionMode(page, mode) {
  if (mode === 'ask') return
  await openAgentPanel(page)
  const label = permissionLabels[mode]
  const select = page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '权限模式' }) })
  await select.locator('.ant-select-selector').click()
  await page.locator('.ant-select-item-option').filter({ hasText: label }).click()
  const confirm = page.getByRole('button', { name: mode === 'bypass' ? /仍要启用/ : '启用自动模式' })
  await confirm.waitFor()
  await confirm.click()
  await confirm.waitFor({ state: 'hidden' })
}

/** Model tool call for the planning turn. */
function taskPlanCalls(selectedObjects, steps, proposedEffects) {
  return [{
    id: 'plan',
    type: 'function',
    function: {
      name: 'propose_task_plan',
      arguments: JSON.stringify({
        selected_objects: selectedObjects,
        ...(proposedEffects ? { proposed_effects: proposedEffects } : {}),
        steps
      })
    }
  }]
}

module.exports = { openAgentPanel, closeAgentPanel, submitAgentGoal, selectPermissionMode, taskPlanCalls, permissionLabels }
