/* lab-m7 —— "M7 · Agent Run 状态机与审批暂停/恢复"
 * 「在线运行」入口：动态加载 lab-runner.js（已加载则直接用），
 * 然后调 window.LABRUNNER 渲染可折叠的浏览器内 Python 运行面板。
 * code 为「在线逻辑版」（仅标准库）；expected 为本地 python3 实跑的真实输出。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['lab-m7'] = function (container) {
  var CONFIG = {
    title: "M7 · Agent Run 状态机与审批暂停/恢复",
    subtitle: "对应篇05-2 实战 · labs/m7-agent-runtime 的统一执行模型核心：状态机白名单 + Checkpoint + 审批幂等键，看一次 Run 如何暂停、恢复、拒绝非法迁移。",
    code: "# ============================================================\n# 在线逻辑版 · M7 Agent Runtime：Run 状态机 + 审批暂停/恢复\n# （对应篇05-2 实战，真实源码 labs/m7-agent-runtime/runtime/execution.py）\n# 工程纪律（篇05 §3.2）：状态迁移只能由 Runtime 发起，\n# 走白名单校验，模型永远无权直接改 Run 状态。\n# ============================================================\nfrom enum import Enum\n\nclass RunState(str, Enum):\n    PENDING = \"PENDING\"\n    RUNNING = \"RUNNING\"\n    WAITING_APPROVAL = \"WAITING_APPROVAL\"\n    COMPLETED = \"COMPLETED\"          # 教程称 SUCCEEDED\n    FAILED = \"FAILED\"\n\n# 状态机白名单：不在表里的迁移一律拒绝\nALLOWED = {\n    RunState.PENDING: {RunState.RUNNING, RunState.FAILED},\n    RunState.RUNNING: {RunState.WAITING_APPROVAL, RunState.COMPLETED, RunState.FAILED},\n    RunState.WAITING_APPROVAL: {RunState.RUNNING, RunState.FAILED},\n}\n\nevents = []\n\ndef transition(run, to):\n    \"\"\"Runtime 唯一的状态入口：非法迁移直接拒绝并留痕\"\"\"\n    if to not in ALLOWED.get(run[\"state\"], set()):\n        events.append(\"  ✗ 拒绝非法迁移 %s -> %s（不在状态机白名单内）\"\n                      % (run[\"state\"].value, to.value))\n        return False\n    events.append(\"  %s -> %s\" % (run[\"state\"].value, to.value))\n    run[\"state\"] = to\n    return True\n\nrun = {\"run_id\": \"run_9001\", \"state\": RunState.PENDING}\nprint(\"Run %s 创建，目标：诊断上周 GMV 下滑并建工单\" % run[\"run_id\"])\nprint(\"\")\n\ntransition(run, RunState.RUNNING)\nevents.append(\"  Step1 query_orders 完成 → Checkpoint 已保存（step_cursor=1）\")\nevents.append(\"  Step2 create_ticket 风险等级 = high → 触发人工审批（Human Gate）\")\ntransition(run, RunState.WAITING_APPROVAL)\nevents.append(\"  … Run 暂停在审批点：事件流 + Checkpoint 已落库，进程可安全退出 …\")\ntransition(run, RunState.RUNNING)   # 审批通过，从 Checkpoint 恢复\nevents.append(\"  审批通过（幂等键 approval#run_9001#step2，重复回调不会重复建单）\")\nevents.append(\"  从 Checkpoint 恢复续跑：Step2 create_ticket 完成\")\ntransition(run, RunState.COMPLETED)\n\nprint(\"状态迁移轨迹（append-only 事件流）：\")\nfor e in events:\n    print(e)\nprint(\"\")\nprint(\"再试一次非法迁移：COMPLETED 之后还想回到 RUNNING 重跑——\")\nn0 = len(events)\ntransition(run, RunState.RUNNING)\nfor e in events[n0:]:\n    print(e)\nprint(\"\")\nprint(\"要点：暂停/恢复靠「Checkpoint + 事件游标」，合法性靠「状态机白名单」，\")\nprint(\"      审批副作用靠「幂等键」——三者齐备，Run 才可恢复、可审计、可重放。\")\n",
    expected: "Run run_9001 创建，目标：诊断上周 GMV 下滑并建工单\n\n状态迁移轨迹（append-only 事件流）：\n  PENDING -> RUNNING\n  Step1 query_orders 完成 → Checkpoint 已保存（step_cursor=1）\n  Step2 create_ticket 风险等级 = high → 触发人工审批（Human Gate）\n  RUNNING -> WAITING_APPROVAL\n  … Run 暂停在审批点：事件流 + Checkpoint 已落库，进程可安全退出 …\n  WAITING_APPROVAL -> RUNNING\n  审批通过（幂等键 approval#run_9001#step2，重复回调不会重复建单）\n  从 Checkpoint 恢复续跑：Step2 create_ticket 完成\n  RUNNING -> COMPLETED\n\n再试一次非法迁移：COMPLETED 之后还想回到 RUNNING 重跑——\n  ✗ 拒绝非法迁移 COMPLETED -> RUNNING（不在状态机白名单内）\n\n要点：暂停/恢复靠「Checkpoint + 事件游标」，合法性靠「状态机白名单」，\n      审批副作用靠「幂等键」——三者齐备，Run 才可恢复、可审计、可重放。"
  };
  if (typeof window.LABRUNNER === 'function') {
    window.LABRUNNER(container, CONFIG);
    return;
  }
  var s = document.createElement('script');
  s.src = 'assets/demos/lab-runner.js';
  s.onload = function () { window.LABRUNNER(container, CONFIG); };
  s.onerror = function () {
    container.innerHTML = '<div class="demo-error">在线运行组件加载失败，可查看本地文件 assets/demos/lab-runner.js</div>';
  };
  document.head.appendChild(s);
};
