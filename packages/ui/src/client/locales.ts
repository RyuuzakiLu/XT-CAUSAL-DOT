/* ================================================================
   DOT 文案 · 总导游图
   ▍这是什么
   个人界面统一中文词典；原生 locale 消费，不在组件散放兜底文案。
   ▍修改铁律
   1. 机器分支用稳定 ID，文案改名不能改变业务。
   ▍更新记录
   *更新：2026-10-23 · 六空间和占位 ASTRA 文案*
   *更新：2026-10-23 · 精灵统一金色环形入口、菜单互斥与返回收起*
================================================================ */
export const zh = {
  brand: 'XTCausal DOT', astra: 'ASTRA', study: '星夜书房', conversation: '对话', work: '工作',
  memory: '记忆', capabilities: '能力', postbox: '星邮匣', back: '返回', menu: '召唤菜单',
  orbitMenu: 'ASTRA 环形菜单', orbitDismiss: '关闭环形菜单',
  close: '收回', pin: '固定', unpin: '取消固定', details: '查看详情', refresh: '刷新',
  send: '发送', stop: '停止', retry: '重试', cancel: '取消工作', supplement: '补充说明',
  draft: '对 ASTRA 说点什么……', newWork: '交代工作', goal: '希望完成什么？',
  connected: '已连接', connecting: '连接中', offline: '未连接，草稿仍保留',
  unavailable: '当前不可用', empty: '这里还没有记录', loading: '正在读取',
  idle: '待机', thinking: '正在回应', executing: '后台正在办事', notice: '有新信件',
  error: '出了点状况', updated: '更新时间', stale: '连接已断开，显示的是上次快照',
  noProgress: '这件事没有可靠的百分比，按实际阶段显示',
  saveMemory: '保存记忆', searchMemory: '搜索记忆', correct: '纠正', delete: '删除记忆',
  deleteConfirm: '确认删除这条记忆？只归档记忆，不删除聊天。',
  text: '正文', search: '搜索', read: '标为已读', archive: '归档', preferences: '提醒偏好',
  dnd: '免打扰', nativeNotifications: '开启系统通知', motion: '减少动画',
  arrange: '整理画布', arrangeConfirm: '按当前卡片整理布局，不改变工作或成果。确认整理？',
  undo: '撤销布局', focus: '聚焦', result: '成果', copy: '复制', download: '下载',
  attachment: '添加附件', voice: '语音输入', recording: '正在听，点此结束',
  voiceUnavailable: '此设备尚未提供可用的语音转写，请使用文字输入',
  spriteArtFailed: '精灵动画没加载出来，点此重试', spriteArtRetry: '重载动画',
  noSecret: '模型、搜索及外部渠道未配置时明确显示不可用，不使用你的现用密钥。',
  studyIntro: '从这里开始，把想说的话与想做的事交给我。',
  studyGreeting: '夜色安静，思绪自由。', studyWelcome: '欢迎回到你的星夜书房',
  portraitWaiting: 'ASTRA 的位置，为她留着', studyFootnote: '你的私人空间 · 对话与工作，各自从容',
  workIntro: '把事情交代清楚，然后放心去忙。进展与成果，会在这里等你。',
  memoryIntro: '值得留下的事，在这里慢慢积成你的星图。',
  capabilitiesIntro: '每一种能力都有来处，每一次连接都有真实状态。',
  postboxIntro: '完成的事情、重要的提醒，还有等你回应的消息。',
  workEmpty: '留一张桌面，给下一件想做的事', workEmptyHint: '交代一件工作后，它的进展与成果会出现在这里。',
  memoryEmpty: '星图，从第一条记忆开始', memoryEmptyHint: '保存一条你希望 ASTRA 记住的事实，或搜索已经留下的记忆。',
  postboxEmpty: '今晚，信箱很安静', postboxEmptyHint: '有工作完成或重要提醒时，信件会来到这里。',
  composeMemory: '留下一条记忆', composeWork: '交代一件事',
  menuCaption: '你想去哪里？', menuHint: '每一处空间，都通向同一个 ASTRA。',
  workHint: '描述你希望得到的结果，不必替我拆每一步。',
  conversationHint: '让对话自然发生', plansHint: '让需要反复惦记的事，有自己的节奏。',
  objectConversation: '聊聊此刻', objectWork: '让事情往前走', objectMemory: '留下重要的事', objectCapabilities: '看看我能做什么', objectPostbox: '收取新的消息',
  spaceTools: '空间工具', canvasLabel: '工作桌面', capabilityInstalled: '已安装能力', capabilityUnavailable: '待连接',
  sourceLabel: '来源', artifactCount: '份成果', artworkReserved: '人物素材待接入',
  modelSettings: '模型与连接设置', connection: '连接地址', save: '保存',
  history: '历史对话', newConversation: '新对话', workRunning: '后台工作',
  queued: '排队中', running: '执行中', 'waiting-input': '等你补充', 'waiting-approval': '等待确认',
  succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', unknown: '状态待核实',
  deleteCard: '收回只是隐藏卡片，后台工作继续。', inspect: '打开',
  memoryBoundary: '只保存你明确交代的事实，不自动记住所有附件。',
  connectionHelp: '输入独立 DOT 服务地址；不修改其他程序的连接。',
  plans: '持续职责', createPlan: '建立职责', pause: '暂停', resume: '恢复', removePlan: '取消职责', intervalMinutes: '间隔分钟', nextRun: '下次执行',
  workCurrent: '当前工作', workStage: '阶段', workArtifacts: '成果', workNoArtifacts: '这件事还没有产出成果',
  workOverview: '其他工作', workOverviewHint: '点「聚焦」把这件事放到主卡上；拖动只调整摆放位置。', workFocusOff: '取消聚焦',
  /* xiaod-resume-ui-20261028：DOT 自己的对话欢迎语（替代原生 hero 那套标题）。 */
  heroGreeting: '今晚想聊点什么？', heroHint: '说一句就好，我在这儿。',
  waitingConfiguration: '等待配置', promptIdentity: '银白长发、细框眼镜、黑金星辰的 ASTRA；美术暂缓。',
} as const
export type DotText = keyof typeof zh
