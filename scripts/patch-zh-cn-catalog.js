#!/usr/bin/env node
/**
 * Fill zh-CN catalog gaps introduced by newer upstream UI bundles.
 *
 * Upstream can ship new React Intl message descriptors before the matching
 * Simplified Chinese catalog is regenerated. In that case the app correctly
 * falls back to defaultMessage, but the affected settings appear in English.
 * Fill exact missing message IDs in the exported zh-CN catalog so unrelated
 * strings and other locales remain untouched. Existing upstream translations
 * are preserved unless an ID is listed as a confirmed upstream correction.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("acorn");
const { SRC_DIR, relPath } = require("./patch-util");

const ZH_CN_TRANSLATION_SPECS = [
  [
    "composer.mode.agentMode.fullAccessConfirm.files.description",
    "读取、创建、修改、上传或删除此计算机上任何位置的文件",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.files.title",
    "文件和文件夹",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.internet.description",
    "访问网站、发送数据以及使用已启用的插件",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.internet.title",
    "互联网和已连接的应用",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.riskDescriptionByModel",
    "这会带来敏感数据丢失或泄露、提示词注入等风险。{isCyberModel, select, true {我们强烈建议改选“替我批准”，并根据你的使用场景自定义审核者策略。} other {你可以随时关闭此功能。}} <link>了解更多</link>",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.terminal.description",
    "运行命令、安装软件和更改系统设置",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.terminal.title",
    "终端命令",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.warningDescription.chatgptMode",
    "ChatGPT 将能够在未经你许可的情况下，在此计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。包括但不限于：",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.warningDescription.codeMode",
    "Codex 将能够在未经你许可的情况下，在此计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。包括但不限于：",
  ],
  ["composer.queuedMessage.openInSideChat", "在侧边聊天中打开"],
  ["composer.modelPicker.default.description", "推荐模型组合"],
  ["composer.modelPicker.default.label", "默认"],
  ["composer.modelPicker.modelList.open.ariaLabel", "选择模型"],
  ["composer.modelPicker.modelList.heading", "选择模型"],
  [
    "composer.modelChangeDuringConversationWarning.v2.toast",
    "在会话中途切换模型会降低性能。为获得最佳体验，请开始新会话，或切换回 {previousModel}。",
  ],
  ["composer.placeholder.plan", "描述你的任务以生成计划…"],
  ["composerTips.planMode.action", "创建计划"],
  ["implementPlanRequest.editedPlanError", "无法使用已编辑的计划，请重试"],
  ["localConversation.planSummary.closeSidePanel", "关闭计划侧边栏"],
  ["localConversation.planSummary.download", "下载计划"],
  ["localConversation.planSummary.openInSidePanel", "在侧边栏中打开计划"],
  ["localConversation.planSummary.title", "计划"],
  [
    "settings.general.experimentalFeatures.requestUserInput.description",
    "允许 Codex 在计划模式之外提问。更改仅适用于新对话串",
  ],
  ["inbox.automations.createWithCodex", "使用 Codex 创建"],
  [
    "localConversation.forkFromOlderTurnDialog.local.label",
    "使用此工作树",
  ],
  [
    "localConversation.forkFromOlderTurnDialog.local.workspaceLabel",
    "使用此工作区",
  ],
  [
    "localConversation.forkFromOlderTurnDialog.worktree.label",
    "使用新工作树",
  ],
  ["projectSetup.createLocalProject.sourceFolderLabel", "源文件夹"],
  ["projectSetup.createLocalProject.sourceFoldersLabel", "源文件夹"],
  ["codex.command.git.createBranch", "创建分支"],
  ["codex.commandDescription.git.createBranch", "打开分支创建选项"],
  ["codex.command.git.createDraftPullRequest", "创建草稿 PR"],
  [
    "codex.commandDescription.git.createDraftPullRequest",
    "打开草稿 PR 创建选项",
  ],
  ["codex.command.git.createPullRequest", "创建 PR"],
  ["codex.commandDescription.git.createPullRequest", "打开 PR 创建选项"],
  ["codex.command.git.mergePullRequest", "合并 PR"],
  ["codex.commandDescription.git.mergePullRequest", "打开 PR 合并选项"],
  ["codex.command.git.openPullRequest", "在 GitHub 上打开 PR"],
  [
    "codex.commandDescription.git.openPullRequest",
    "打开与当前聊天关联的 PR",
  ],
  ["codex.command.redoAppAction", "重做上一步操作"],
  [
    "codex.commandDescription.redoAppAction",
    "重做最近撤销的应用操作",
  ],
  ["codex.command.settings", "设置"],
  ["codex.commandDescription.settings", "打开 {appName} 设置"],
  ["codex.command.undoAppAction", "撤销上一步操作"],
  ["codex.commandDescription.undoAppAction", "撤销最近一次应用操作"],
  ["codex.command.composer.openProjectPicker", "打开项目选择器"],
  [
    "codex.commandDescription.composer.openProjectPicker",
    "打开当前输入框的项目选择器",
  ],
  ["codex.command.composer.startDictation", "开始听写"],
  [
    "codex.commandDescription.composer.startDictation",
    "在当前输入框中开始听写",
  ],
  ["codex.command.composer.startVoiceMode", "切换语音模式"],
  [
    "codex.commandDescription.composer.startVoiceMode",
    "开始或停止语音聊天",
  ],
  ["codex.command.composer.submit", "发送消息"],
  [
    "codex.commandDescription.composer.submit",
    "发送当前输入框中的消息",
  ],
  ["codex.command.composer.toggleFastMode", "切换快速模式"],
  [
    "codex.commandDescription.composer.toggleFastMode",
    "在当前输入框中开启或关闭快速模式",
  ],
  ["codex.command.composer.togglePlanMode", "切换规划模式"],
  [
    "codex.commandDescription.composer.togglePlanMode",
    "在当前输入框中开启或关闭规划模式",
  ],
  ["codex.command.composer.toggleWorktreeMode", "切换本地/工作树"],
  [
    "codex.commandDescription.composer.toggleWorktreeMode",
    "将当前输入框切换到本地模式或新工作树",
  ],
  ["codex.command.copyConversationMarkdown", "复制为 Markdown"],
  [
    "codex.commandDescription.copyConversationMarkdown",
    "将当前聊天复制为 Markdown",
  ],
  ["codex.command.searchChats", "切换聊天…"],
  ["codex.commandDescription.searchChats", "搜索并切换到聊天"],
  ["codex.command.realtimeVoice", "语音聊天快捷键"],
  ["codex.command.realtimeVoice.endCall", "结束语音聊天"],
  [
    "codex.command.realtimeVoice.toggleMicrophoneMute",
    "切换语音聊天麦克风",
  ],
  ["codex.command.realtimeVoice.toggleOutputMute", "切换语音聊天音频"],
  [
    "codex.commandDescription.realtimeVoice",
    "从桌面任意位置启动语音聊天",
  ],
  [
    "codex.commandDescription.realtimeVoice.endCall",
    "结束当前语音聊天",
  ],
  [
    "codex.commandDescription.realtimeVoice.toggleMicrophoneMute",
    "在语音聊天期间将麦克风静音或取消静音",
  ],
  [
    "codex.commandDescription.realtimeVoice.toggleOutputMute",
    "将语音聊天音频静音或取消静音",
  ],
  ["settings.voice.general", "通用"],
  ["settings.general.microphoneInput.description", "用于语音聊天和听写"],
  ["settings.general.realtimeVoice", "语音聊天"],
  [
    "settings.general.realtimeVoice.accessError",
    "无法验证语音聊天访问权限",
  ],
  [
    "settings.general.realtimeVoice.accessLoading",
    "正在检查语音聊天访问权限…",
  ],
  ["settings.general.realtimeVoice.choose", "选择语音"],
  ["settings.general.realtimeVoice.dialog.cancel", "取消"],
  ["settings.general.realtimeVoice.dialog.close", "关闭"],
  ["settings.general.realtimeVoice.dialog.done", "完成"],
  ["settings.general.realtimeVoice.dialog.title", "选择语音"],
  ["settings.general.realtimeVoice.loadError", "无法加载语音设置"],
  ["settings.general.realtimeVoice.loading", "正在加载..."],
  ["settings.general.realtimeVoice.next", "下一个语音"],
  [
    "settings.general.realtimeVoice.noVoices",
    "没有可用的兼容语音",
  ],
  [
    "settings.general.realtimeVoice.optionLabel",
    "{name}：{description}",
  ],
  [
    "settings.general.realtimeVoice.previewPause",
    "暂停 {name} 试听",
  ],
  [
    "settings.general.realtimeVoice.previewPlay",
    "播放 {name} 试听",
  ],
  [
    "settings.general.realtimeVoice.previewReplay",
    "重新播放 {name} 试听",
  ],
  [
    "settings.general.realtimeVoice.previewRetry",
    "重试 {name} 试听",
  ],
  ["settings.general.realtimeVoice.previewUnavailable", "无法试听"],
  ["settings.general.realtimeVoice.previous", "上一个语音"],
  ["settings.general.realtimeVoice.retry", "重试"],
  ["settings.general.realtimeVoice.saveError", "无法保存语音"],
  [
    "settings.general.realtimeVoice.selectedAnnouncement",
    "已选择语音：{name}。{description}",
  ],
  [
    "settings.general.realtimeVoice.unavailable.label",
    "语音聊天不可用",
  ],
  [
    "settings.general.realtimeVoice.unavailable.description",
    "你的账户或工作区无法使用语音聊天",
  ],
  [
    "settings.general.realtimeVoice.voice.arbor.description",
    "轻松随和、灵活多变",
  ],
  [
    "settings.general.realtimeVoice.voice.breeze.description",
    "生动热情、真挚自然",
  ],
  [
    "settings.general.realtimeVoice.voice.cove.description",
    "沉稳直接",
  ],
  [
    "settings.general.realtimeVoice.voice.description",
    "选择 Codex 用于新语音聊天的声音",
  ],
  [
    "settings.general.realtimeVoice.voice.ember.description",
    "自信乐观",
  ],
  [
    "settings.general.realtimeVoice.voice.juniper.description",
    "开朗积极",
  ],
  ["settings.general.realtimeVoice.voice.label", "语音"],
  [
    "settings.general.realtimeVoice.voice.maple.description",
    "愉快坦率",
  ],
  [
    "settings.general.realtimeVoice.voice.sol.description",
    "睿智从容",
  ],
  [
    "settings.general.realtimeVoice.voice.spruce.description",
    "平静肯定",
  ],
  [
    "settings.general.realtimeVoice.voice.vale.description",
    "明快好奇",
  ],
  ["sidebarElectron.deleteThread", "删除聊天"],
  ["sidebarElectron.deleteThreadConfirmAction", "确认"],
  ["sidebarElectron.deleteThreadError", "删除聊天失败"],
  [
    "settings.general.realtimeVoiceHotkey.captureAriaLabel",
    "语音聊天快捷键录制",
  ],
  [
    "settings.general.realtimeVoiceHotkey.description",
    "从桌面任意位置启动语音聊天",
  ],
  [
    "settings.general.realtimeVoiceHotkey.errorGeneric",
    "更新语音聊天快捷键失败",
  ],
  ["settings.general.realtimeVoiceHotkey.label", "语音聊天快捷键"],
  ["settings.general.realtimeVoiceHotkey.off", "关闭"],
  [
    "settings.general.realtimeVoiceScreenContext.ariaLabel",
    "为语音聊天启用屏幕上下文",
  ],
  [
    "settings.general.realtimeVoiceScreenContext.description",
    "当你提到屏幕上的内容时，允许 Codex 查看前台应用。macOS 会在 Codex 首次需要时请求权限",
  ],
  ["settings.general.realtimeVoiceScreenContext.label", "屏幕上下文"],
  [
    "appUpdate.relaunchNotice.titleDays",
    "{count, plural, one {# 天内需要重启} other {# 天内需要重启}}",
  ],
  [
    "appUpdate.relaunchNotice.titleHours",
    "{count, plural, one {# 小时内需要重启} other {# 小时内需要重启}}",
  ],
  [
    "appUpdate.relaunchNotice.titleMinutes",
    "{count, plural, one {# 分钟内需要重启} other {# 分钟内需要重启}}",
  ],
  ["appUpdate.relaunchNotice.titleNow", "现在需要重启"],
  ["chart.tooltip.moreEntries", "+{count, number} 项"],
  ["codex.command.switchToChat", "切换到聊天"],
  ["codex.command.switchToCodex", "切换到 Codex"],
  ["codex.command.switchToWork", "切换到工作"],
  ["codex.commandDescription.switchToChat", "切换到聊天模式"],
  ["codex.commandDescription.switchToCodex", "切换到 Codex 模式"],
  ["codex.commandDescription.switchToWork", "切换到工作模式"],
  ["codex.composer.imageAttachment", "用户附件"],
  ["codex.diffView.applyPatchError", "应用更改失败"],
  ["codex.diffView.applyPatchNotGitRepo", "应用更改需要 Git 仓库"],
  ["codex.diffView.applyPatchPartialSuccess", "已应用部分更改"],
  ["codex.diffView.applyPatchSuccess", "已应用更改"],
  ["codex.diffView.revertPatchError", "撤销更改失败"],
  ["codex.diffView.revertPatchNotGitRepo", "撤销更改需要 Git 仓库"],
  ["codex.diffView.revertPatchPartialSuccess", "已撤销部分更改"],
  ["codex.diffView.revertPatchSuccess", "已撤销更改"],
  ["codex.rateLimitResetPromptModal.resetExpiresWithTimeZone", "将于 {date} 到期"],
  ["codex.threadFindBar.results", "{active} / {matches} 个结果"],
  ["codex.threadFindBar.results.capped", "{active} / {matches}+ 个结果"],
  ["codex.unifiedDiff.reapplyPatchSuccess", "已重新应用更改"],
  ["codex.unifiedDiff.revertPatchSuccess", "已撤销更改"],
  [
    "composer.runLocation.cloud.tooltip.workspaceDisabled",
    "你的工作区管理员已禁用云端工作",
  ],
  [
    "composer.runLocation.local.tooltip.workspaceDisabled",
    "你的工作区管理员已禁用在本机工作",
  ],
  ["imageAttachment.editImage", "编辑图片"],
  ["projectsIndex.chatGpt.pinProject", "置顶项目"],
  ["projectsIndex.chatGpt.unpinProject", "取消置顶项目"],
  ["pullRequestDetail.description.editorLabel", "描述编辑器"],
  ["pullRequestDetail.description.generating", "正在生成描述"],
  ["pullRequestDetail.description.stopGenerating", "停止生成"],
  [
    "settings.general.inAppUpdates.description.managed",
    "你的组织已关闭应用内更新",
  ],
  ["settings.general.inAppUpdates.label", "应用内更新"],
  ["settings.general.inAppUpdates.status.managed", "由组织管理"],
  ["settings.import.autosync.afterImport", "首次导入后可用"],
  ["settings.import.autosync.content", "要同步的内容"],
  ["settings.import.autosync.customize", "自定义"],
  [
    "settings.import.autosync.paused",
    "同步已暂停。你的内容选择已保存",
  ],
  ["settings.import.history.entryTitle.fromProvider", "从 {provider} 导入"],
  ["settings.usage.limits.requestSaved", "请求已提交"],
  ["settings.usage.limits.requestUpdated", "请求已更新"],
  ["settings.usage.resets.expiresWithTimeZone", "将于 {date} 到期"],
  ["sidebarElectron.chatsSortMenu.title", "聊天排序方式"],
  ["sidebarElectron.priorityThreads.archiveCancel", "取消"],
  ["sidebarElectron.priorityThreads.archiveConfirm", "归档"],
  [
    "sidebarElectron.priorityThreads.archiveConfirmationDescription",
    "最近的聊天不会被归档",
  ],
  [
    "sidebarElectron.priorityThreads.archiveConfirmationTitle",
    "{count, plural, one {归档 # 个动态聊天？} other {归档 # 个动态聊天？}}",
  ],
  [
    "sidebarElectron.priorityThreads.archiveFailure",
    "{successCount, plural, one {已归档 # 个动态聊天} other {已归档 # 个动态聊天}}；{failedCount} 个未能归档",
  ],
  ["sidebarElectron.priorityThreads.archivePriorityThreads", "归档聊天"],
  [
    "sidebarElectron.priorityThreads.archiveSuccess",
    "{count, plural, one {已归档 # 个动态聊天} other {已归档 # 个动态聊天}}",
  ],
  ["sidebarElectron.priorityThreads.archiving", "正在归档…"],
  ["sidebarElectron.priorityThreads.details.chat", "聊天"],
  ["sidebarElectron.priorityThreads.details.cloud", "云端"],
  ["sidebarElectron.priorityThreads.details.codex", "Codex"],
  ["sidebarElectron.priorityThreads.details.work", "工作"],
  ["sidebarElectron.priorityThreads.markAllAsRead", "全部标为已读"],
  ["sidebarElectron.priorityThreads.options", "动态视图选项"],
  ["sidebarElectron.priorityThreads.recent.today", "今天"],
  ["sidebarElectron.priorityThreads.recent.yesterday", "昨天"],
  ["sidebarElectron.priorityThreads.restoreDefaults", "恢复默认设置"],
  ["sidebarElectron.priorityThreads.showChat", "聊天"],
  ["sidebarElectron.priorityThreads.showPinned", "已置顶"],
  ["sidebarElectron.priorityThreads.showScheduled", "已计划"],
  ["sidebarElectron.priorityThreads.showSection", "显示"],
  ["sidebarElectron.priorityThreads.showWork", "工作"],
  ["sidebarElectron.skillsAppsRouteNavLink.newChip", "新"],
  ["sidebarOnboardingChecklist.collapseChecklist", "收起清单"],
  ["sidebarOnboardingChecklist.expandChecklist", "展开清单"],
  ["sidebarOnboardingChecklist.exploreCodex", "了解 Codex 的功能"],
  [
    "sidebarOnboardingChecklist.exploreCodex.prompt",
    "帮助我了解 Codex 的功能，并推荐三个实用的入门方式",
  ],
  ["serviceTier.ultrafast.description", "为时延敏感型任务提供最快响应"],
  // Conditional dialogs, notices, and recovery paths audited in 26.901.51231.
  ["appgenShareDialog.externalEmailPlaceholder", "输入电子邮箱地址"],
  ["appShell.detachedWindow.focusSourceFailed", "无法显示任务"],
  ["artifactSession.loadFailed", "无法打开此实时电子表格。"],
  ["artifactSession.syncProblem", "更改可能尚未同步到此内容会话。"],
  ["artifactSession.unavailable", "此应用宿主不支持实时内容会话。"],
  [
    "browser.auth.error.accountDeactivated",
    "你的账户已被删除或停用。如果你认为这是误判，请通过<helpLink>帮助中心</helpLink>联系我们。",
  ],
  ["browser.auth.error.busy", "我们的系统目前有些繁忙。请稍后重试。"],
  ["browser.auth.error.default", "登录时出了点问题。请返回后重试。"],
  ["browser.auth.error.goBack", "返回"],
  ["browser.auth.error.logoutFailed", "无法退出登录。请返回后重试。"],
  ["browser.auth.error.providerMismatch", "你尝试使用的登录方式与注册时不同。请返回并使用最初的登录方式重试。"],
  ["browser.auth.error.safetyConversationRemoved", "我们已移除被系统标记的会话，并暂停你的账户 24 小时"],
  [
    "browser.auth.error.safetyEmergency",
    "如果任何人的安全受到威胁，请联系当地紧急救援服务或<helplineLink>危机援助热线</helplineLink>",
  ],
  ["browser.auth.error.safetyExplanation", "ChatGPT 无法继续涉及暴力风险或伤害他人的会话"],
  ["browser.auth.error.safetyLearnMore", "了解更多"],
  ["browser.auth.error.safetySupport", "如需更多支持，请联系你信任的人或受过培训的专业人士"],
  ["browser.auth.error.safetyTitle", "出于安全原因，我们已暂停你的账户"],
  ["browser.auth.error.ssoRequired", "你的组织要求使用单点登录（SSO）。请返回并使用组织的 SSO 登录。"],
  ["browser.auth.error.title", "出了点问题！"],
  [
    "browser.auth.error.unknownCountry",
    "无法确定你所在的国家或地区。请尝试使用其他网络，或通过<helpLink>帮助中心</helpLink>联系我们。",
  ],
  ["browser.auth.error.unsupportedRegion", "我们的服务在你所在的国家或地区不可用"],
  ["browser.auth.handoff.continue", "继续"],
  ["browser.auth.handoff.failed", "无法登录。请重试"],
  ["browser.auth.handoff.retry", "重试"],
  ["browser.auth.handoff.title", "继续登录"],
  ["browser.auth.magicLink.continue", "继续"],
  ["browser.auth.magicLink.failed", "无法验证你的链接。请重新开始以获取新链接。"],
  ["browser.auth.magicLink.pending", "只需稍等片刻"],
  ["browser.auth.magicLink.restart", "返回"],
  ["browser.auth.magicLink.title", "正在验证你的链接"],
  ["chatgpt.global_search.modal.clear_button.label", "清除"],
  ["chatgpt.global_search.modal.close_button.aria_label", "关闭全局搜索"],
  ["chatgpt.global_search.modal.close_button.tooltip", "关闭搜索"],
  ["chatgpt.global_search.modal.filters_button.tooltip.hide", "隐藏筛选条件"],
  ["chatgpt.global_search.modal.input.label", "搜索"],
  ["chatgpt.global_search.modal.input.placeholder", "搜索…"],
  ["chatgpt.global_search.modal.load_more", "加载更多"],
  ["chatgpt.global_search.modal.no_results", "无结果"],
  ["chatgpt.global_search.modal.title", "全局搜索"],
  ["chatgpt.global_search.modal.zero_state.section.recent_chats.title", "最近的聊天"],
  ["chatgpt.global_search.result_type.project", "项目"],
  [
    "chatgpt.new-onboarding.chatgpt-review-training-disclaimer",
    "ChatGPT 可能会出错。聊天可能会被审阅并用于训练。<learnMoreLink>了解更多</learnMoreLink>",
  ],
  [
    "chatgpt.new-onboarding.chatgpt-review-training-sensitive-info-disclaimer",
    "ChatGPT 可能会出错。请勿分享敏感信息。聊天可能会被审阅并用于训练。<learnMoreLink>了解更多</learnMoreLink>",
  ],
  ["chatgpt.pythonExecution.downloadImageFailed", "无法下载图片。请重试"],
  ["chatgpt.pythonExecution.retryImage", "图片不可用，请重试"],
  ["chatgptConversations.composer.rateLimitHardBlock.tooltip", "已达到消息数量上限"],
  ["chatgptConversations.rateLimitBanner.creditRequest.alreadyRequested", "你已通知管理员"],
  ["chatgptConversations.rateLimitBanner.creditRequest.error", "无法发送额度申请。请重试"],
  ["chatgptConversations.rateLimitBanner.creditRequest.notifyAdmin", "通知管理员"],
  ["chatgptConversations.rateLimitBanner.creditRequest.requested", "已申请"],
  ["chatgptConversations.rateLimitBanner.creditRequest.requestedTooltip", "你已通知管理员"],
  ["chatgptConversations.rateLimitBanner.creditRequest.success", "已向管理员发送申请"],
  ["chatgptConversations.shareDialog.messageDescription", "仅分享此回复，不会分享聊天中的其他内容"],
  ["chatgptConversations.shareDialog.messageLinkAudience", "任何拥有此链接的人都可以查看此回复"],
  ["chatgptConversations.shareDialog.messageTitle", "分享回复"],
  ["chatgptConversations.summaryPanel.sources.loadError", "无法加载记忆来源"],
  ["chatgptConversations.summaryPanel.sources.memory.feedback.thanks", "感谢你的反馈！我会记住的"],
  ["chatgptConversations.summaryPanel.sources.pastConversation.delete", "删除聊天"],
  ["chatgptConversations.summaryPanel.sources.pastConversation.deletedTooltip", "此聊天已被删除。"],
  ["chatgptConversations.summaryPanel.sources.pastConversation.deleteError", "删除聊天失败"],
  ["chatgptConversations.summaryPanel.sources.retry", "重试"],
  [
    "chatgptConversations.temporaryChat.onboarding.customInstructions.description",
    "临时聊天不会遵循你的自定义指令",
  ],
  ["chatgptConversations.temporaryChat.onboarding.customInstructions.title", "不使用自定义指令"],
  [
    "chatgptConversations.temporaryChat.onboarding.description.memoryUnavailable",
    "临时聊天不会出现在你的历史记录中。临时聊天不会遵循你的自定义指令。",
  ],
  [
    "chatgptConversations.temporaryChat.onboarding.description.personalizationSources",
    "此聊天不会出现在历史记录中。你可以选择是否允许 ChatGPT 使用记忆、文件、插件和自定义指令来提供个性化回复。",
  ],
  [
    "chatgptConversations.temporaryChat.onboarding.description.personalizationSourcesWithoutMemory",
    "此聊天不会出现在历史记录中。你可以选择是否允许 ChatGPT 使用文件、插件和自定义指令来提供个性化回复。",
  ],
  ["chatgptConversations.temporaryChat.onboarding.noModelTraining.description", "临时聊天不会用于改进我们的模型"],
  ["chatgptConversations.temporaryChat.onboarding.noModelTraining.title", "不用于模型训练"],
  [
    "chatgptConversations.temporaryChat.onboarding.notInHistory.workspaceDescription",
    "临时聊天不会出现在你的历史记录中",
  ],
  ["chatgptConversations.temporaryChat.onboarding.personalizationSources.title", "临时聊天"],
  ["chatGptMemoryOnboarding.continue", "继续"],
  ["chatGptMemoryOnboarding.controlsAndTraining", "你可以在个性化设置中关闭记忆。如果启用了模型训练，记忆可能会用于改进我们的模型"],
  ["chatGptMemoryOnboarding.description", "记忆可帮助 ChatGPT 在不同会话中为你提供个性化回复"],
  ["chatGptMemoryOnboarding.enable", "启用"],
  ["chatGptMemoryOnboarding.notNow", "暂不启用"],
  ["chatGptMemoryOnboarding.personalizedResponses", "已保存的记忆和聊天历史可让今后的回复更贴合你的需求"],
  ["chatGptMemoryOnboarding.savedDetails", "ChatGPT 可以记住你分享的有用信息和偏好"],
  ["chatGptMemoryOnboarding.title", "ChatGPT 现在支持记忆功能"],
  ["chatGptMemoryOnboarding.updateError", "无法更新记忆设置"],
  ["codex.businessCreditCheckout.failed", "无法打开结算页面。请重试"],
  ["codex.chatGptSearch.dialogDescription", "搜索你的聊天、项目、图片和文档"],
  ["codex.chatGptSearch.fileProcessing", "此文件仍在处理中"],
  ["codex.chatGptSearch.fileUnavailable", "无法处理此文件"],
  ["codex.chatGptSearch.loading", "正在加载搜索结果…"],
  ["codex.chatGptSearch.previewFailed", "无法打开文件预览"],
  ["codex.chatGptSearch.retry", "重试"],
  ["codex.chatGptSearch.searchFailed", "无法加载搜索结果"],
  ["codex.review.fileWatchLimited.message", "无法监视部分文件的更改。请刷新以更新此视图。"],
  ["codex.review.fileWatchLimited.refresh", "刷新"],
  ["codex.safetyComposerBanner.cyber.daybreakEnabledBody", "即使开启 Daybreak，部分网络安全请求仍会受到限制。"],
  [
    "codex.safetyComposerBanner.cyber.daybreakUnsupportedModelBody",
    "Astra 不支持 Daybreak。部分网络安全请求仍可能受到限制。",
  ],
  ["codex.visualization.annotationSubmitFailure", "无法提交可视化更改"],
  ["codex.writingBlock.confirmCloseCancel", "取消"],
  ["codex.writingBlock.confirmCloseConfirm", "关闭"],
  ["codex.writingBlock.confirmClosePendingEdits", "你还有待处理的编辑，确定要关闭吗？"],
  ["codex.writingBlock.confirmCloseTitle", "关闭编辑器？"],
  ["codex.writingBlock.library.syncError", "无法同步此文档 · <retry>重试</retry>"],
  ["codexFastModeAnnouncementModal.heroLabel.withMultiplier", "前沿智能，{speedMultiplier, number} 倍速度"],
  [
    "codexUpgradeModal.bodyGpt6Astra",
    "这是 GPT-6，新一代智能模型。Astra 在编程、电脑操作、科学和专业工作领域拥有领先能力。把一道难题、一个尚未成形的想法，或一直想实现的项目交给它，看看它能带来什么。",
  ],
  [
    "composer.computerUseAppApproval.disclosure",
    "电脑操作功能允许 ChatGPT 使用你电脑上的应用。操作过程中可能会截取应用内容的屏幕截图。你可以选择 ChatGPT 能访问哪些应用，随时停止操作，并控制截图是否用于训练。",
  ],
  ["composer.connectorAuth.connectionError", "无法连接此应用"],
  ["composer.daybreak.modelUnavailableOnSubmit", "请关闭 Daybreak 或选择其他模型以继续"],
  ["composer.modelPicker.daybreak.modelUnavailable", "请关闭 Daybreak 以使用此模型"],
  ["composer.modelPicker.lockedModel.ariaLabel", "{model}，已锁定"],
  ["composer.modelPicker.lockedModel.status", "已锁定，点击查看访问选项"],
  ["composer.modelPicker.lockedModel.unlockLabel", "解锁 {model}"],
  ["composer.modelPicker.resetToDefault", "恢复默认"],
  ["composer.modelPicker.selectEffort.label", "选择推理强度"],
  ["composer.realtime.remoteProjectUnsupported", "远程项目不支持语音功能"],
  ["consumerAnalyticsPreview.chats.error", "无法加载聊天用量"],
  ["consumerAnalyticsPreview.limitHistory.breakdownUnavailable", "此时段的用量明细不可用"],
  ["consumerAnalyticsPreview.limitHistory.error", "无法加载限额历史记录"],
  ["consumerAnalyticsPreview.limitHistory.totalUnavailable", "不可用"],
  ["consumerAnalyticsPreview.limitHistory.unavailable", "限额历史记录暂不可用"],
  ["electron.onboarding.login.browserDidNotOpen", "浏览器没有打开？"],
  ["electron.onboarding.login.copyLink", "复制登录链接"],
  ["electron.onboarding.login.linkCopied", "已复制登录链接"],
  ["errorRecovery.retryDescription", "出了点问题。请重试以继续"],
  ["feedback.dialog.includeChatGptConversationAndDiagnosticLogsLabel", "包含此 ChatGPT 会话和诊断日志"],
  ["feedback.dialog.includeDiagnosticLogsLabel", "包含 ChatGPT 诊断日志"],
  ["feedback.dialog.uploadDisabledMessage", "你的配置已禁用反馈发送功能"],
  ["feedback.dialog.uploadDisabledTitle", "反馈功能已禁用"],
  ["feedback.dialog.uploadIncompleteMessage", "已收到你的反馈，但部分诊断文件未能上传"],
  ["feedback.dialog.uploadUnconfirmedMessage", "无法确认是否已收到你的反馈。反馈可能已经送达，再次发送可能会产生重复记录"],
  ["feedback.dialog.uploadUnconfirmedTitle", "反馈上传状态未确认"],
  ["feedback.reports.uploadToast", "反馈上传"],
  ["feedback.reports.viewUpload", "查看上传"],
  ["libraryNext.access.denied", "请登录 ChatGPT 以打开你的资料库。"],
  ["libraryNext.actions.delete", "删除"],
  ["libraryNext.actions.deleteFileFailed", "删除文件失败。"],
  ["libraryNext.actions.deleteFolderFailed", "删除文件夹失败。"],
  ["libraryNext.actions.deleteItem", "{kind, select, directory {删除文件夹} other {删除}}"],
  ["libraryNext.actions.downloadFileFailed", "下载文件失败。"],
  ["libraryNext.actions.renameFileFailed", "重命名 {fileName} 失败。"],
  ["libraryNext.actions.renameFolderFailed", "重命名文件夹失败。"],
  ["libraryNext.create.cancel", "取消"],
  ["libraryNext.create.submitStatus", "{pending, select, true {正在创建…} other {创建}}"],
  ["libraryNext.createFolder.failed", "创建文件夹失败。"],
  ["libraryNext.createFolder.name", "文件夹名称"],
  ["libraryNext.createFolder.title", "新建文件夹"],
  ["libraryNext.delete.confirmItems", "{singleFolder, select, true {删除文件夹} other {删除}}"],
  ["libraryNext.delete.dismiss", "{bulkFiles, select, true {返回} other {取消}}"],
  ["libraryNext.delete.fileDescription", "“<bold>{fileName}</bold>”将移至“最近删除”，并在 30 天后永久删除。"],
  [
    "libraryNext.delete.filesDescription",
    "{count, plural, one {此文件将移至“最近删除”，并在 30 天后永久删除。} other {这些文件将移至“最近删除”，并在 30 天后永久删除。}}",
  ],
  ["libraryNext.delete.filesTitle", "{count, plural, one {删除文件？} other {删除这些文件？}}"],
  ["libraryNext.delete.folderDescription", "“{name}”及其所有文件和子文件夹将被永久删除。"],
  ["libraryNext.delete.foldersWarning", "删除所选文件夹也会删除其中的所有文件和子文件夹。"],
  ["libraryNext.delete.folderTitle", "{count, plural, one {删除文件夹} other {删除所选项目}}"],
  ["libraryNext.delete.irreversible", "此操作无法撤销。"],
  [
    "libraryNext.delete.mixedDescription",
    "{count, plural, one {此选中项目将被永久删除。} other {这 # 个选中项目将被永久删除。}}",
  ],
  ["libraryNext.delete.storage", "永久删除以释放 {size} 存储空间。"],
  ["libraryNext.dialog.cancel", "取消"],
  ["libraryNext.folder.hiddenName", "文件夹名称不能以“.”开头。"],
  ["libraryNext.rename.itemTitle", "{kind, select, directory {重命名文件夹} other {重命名文件}}"],
  ["libraryNext.rename.submitStatus", "{pending, select, true {正在重命名…} other {重命名}}"],
  ["libraryNext.results.failed", "加载文件失败。"],
  ["libraryNext.results.pageFailed", "加载文件失败。"],
  ["libraryNext.selection.chatFailed", "无法使用这些文件开始聊天"],
  ["libraryNext.upload.failedTitle", "上传失败"],
  ["libraryNext.upload.progress", "正在上传 {count, plural, one {# 个文件} other {# 个文件}}"],
  [
    "localConversation.guidedDiagnostics.category",
    "{category, select, network {网络} auth {身份验证} permissions {权限} workspace_setup {工作区设置} sandbox_approval {沙箱或批准} quota_rate_limit {配额或请求频率限制} platform_incident {平台故障} unknown {未知} other {未知}}",
  ],
  [
    "localConversation.guidedDiagnostics.evidence",
    "{signal, select, http_401_unauthorized {匹配信号：HTTP 401 或未授权} expired_or_invalid_token {匹配信号：令牌已过期或无效} session_refresh_failed {匹配信号：会话刷新失败} account_mismatch {匹配信号：账户不匹配} http_403_forbidden {匹配信号：HTTP 403 或访问被禁止} permission_denied {匹配信号：权限被拒绝} access_missing {匹配信号：缺少访问权限} dns_host_lookup_failure {匹配信号：DNS 或主机查询失败} timeout {匹配信号：超时} connection_failure {匹配信号：连接失败} blocked_host {匹配信号：主机被拦截} http_429_too_many_requests {匹配信号：HTTP 429 或请求过多} rate_limit {匹配信号：请求频率限制} quota_usage_limit {匹配信号：配额或用量限额} missing_repo {匹配信号：缺少仓库} missing_dependency {匹配信号：缺少依赖} unsupported_environment {匹配信号：不支持的环境} sandbox_blocked_operation {匹配信号：沙箱拦截了操作} approval_missing {匹配信号：缺少批准} platform_incident {OpenAI 状态页面报告了可能相关的服务故障} none {未匹配到具体的诊断信号} other {未匹配到具体的诊断信号}}；用户可见错误：{errorMessage}",
  ],
  [
    "localConversation.guidedDiagnostics.handoff.category",
    "诊断类别：{category, select, network {网络} auth {身份验证} permissions {权限} workspace_setup {工作区设置} sandbox_approval {沙箱或批准} quota_rate_limit {配额或请求频率限制} platform_incident {平台故障} unknown {未知} other {未知}}",
  ],
  [
    "localConversation.guidedDiagnostics.handoff.diagnosticMethod",
    "诊断方式：根据可见错误和应用提供的详情，使用确定性的本地规则进行诊断；OpenAI 服务状态仅作为辅助信息",
  ],
  [
    "localConversation.guidedDiagnostics.handoff.evidence.signal",
    "- {signal, select, http_401_unauthorized {匹配信号：HTTP 401 或未授权} expired_or_invalid_token {匹配信号：令牌已过期或无效} session_refresh_failed {匹配信号：会话刷新失败} account_mismatch {匹配信号：账户不匹配} http_403_forbidden {匹配信号：HTTP 403 或访问被禁止} permission_denied {匹配信号：权限被拒绝} access_missing {匹配信号：缺少访问权限} dns_host_lookup_failure {匹配信号：DNS 或主机查询失败} timeout {匹配信号：超时} connection_failure {匹配信号：连接失败} blocked_host {匹配信号：主机被拦截} http_429_too_many_requests {匹配信号：HTTP 429 或请求过多} rate_limit {匹配信号：请求频率限制} quota_usage_limit {匹配信号：配额或用量限额} missing_repo {匹配信号：缺少仓库} missing_dependency {匹配信号：缺少依赖} unsupported_environment {匹配信号：不支持的环境} sandbox_blocked_operation {匹配信号：沙箱拦截了操作} approval_missing {匹配信号：缺少批准} platform_incident {OpenAI 状态页面报告了可能相关的服务故障} none {未匹配到具体的诊断信号} other {未匹配到具体的诊断信号}}",
  ],
  ["localConversation.guidedDiagnostics.handoff.evidence.userError", "- 用户可见错误：{errorMessage}"],
  ["localConversation.guidedDiagnostics.handoff.evidenceHeading", "已脱敏的诊断依据："],
  ["localConversation.guidedDiagnostics.handoff.productSurface", "产品界面：Codex"],
  [
    "localConversation.guidedDiagnostics.handoff.recommendedStep",
    "建议的下一步：{category, select, network {检查网络、VPN 或代理后重试} auth {退出后重新登录，然后在目标工作区中重试} permissions {切换到目标工作区，或请管理员授予所需权限} workspace_setup {运行设置流程或安装缺失的依赖后重试} sandbox_approval {为被拦截的操作请求批准，或使用受支持且无需提升权限的方式} quota_rate_limit {等待限额周期重置、减少请求量，或检查此工作区的用量限额} platform_incident {请稍后重试。如果问题持续出现，请复制诊断详情以寻求支持} unknown {如果问题持续出现，请复制诊断详情} other {如果问题持续出现，请复制诊断详情}}",
  ],
  [
    "localConversation.guidedDiagnostics.handoff.remediationAttempted",
    "已尝试的排查步骤：针对此错误运行限定范围的引导式诊断，并检查 OpenAI 公开服务状态",
  ],
  [
    "localConversation.guidedDiagnostics.handoff.status.activeIncident",
    "OpenAI 服务状态：可能相关的故障：{incidentNames}",
  ],
  [
    "localConversation.guidedDiagnostics.handoff.status.activeIncidentWithoutName",
    "OpenAI 服务状态：有可能相关的故障尚未解决",
  ],
  ["localConversation.guidedDiagnostics.handoff.status.noMatchingIncident", "OpenAI 服务状态：未发现相关故障"],
  ["localConversation.guidedDiagnostics.handoff.status.unavailable", "OpenAI 服务状态：无法检查；已改用本地错误详情"],
  ["localConversation.guidedDiagnostics.handoff.threadId", "任务/会话 ID：{threadId}"],
  ["localConversation.guidedDiagnostics.handoff.threadIdUnavailable", "任务/会话 ID：不可用"],
  ["localConversation.guidedDiagnostics.handoff.timestamp", "时间戳（UTC）：{timestamp}"],
  ["localConversation.guidedDiagnostics.handoff.timestampUnavailable", "时间戳（UTC）：不可用"],
  ["localConversation.guidedDiagnostics.handoff.title", "Codex 诊断交接信息"],
  ["localConversation.guidedDiagnostics.handoff.turnId", "轮次 ID：{turnId}"],
  ["localConversation.guidedDiagnostics.handoff.turnIdUnavailable", "轮次 ID：不可用"],
  [
    "localConversation.guidedDiagnostics.handoff.unavailableEvidence",
    "Codex 无法访问或验证：计算机的其他日志、本地原始文件、机密信息、无关任务的日志、完整终端历史或其他用户的数据",
  ],
  ["localConversation.guidedDiagnostics.handoff.userVisibleError", "用户可见错误：{errorMessage}"],
  ["localConversation.guidedDiagnostics.inline.hideDiagnostics", "隐藏诊断"],
  ["localConversation.guidedDiagnostics.inline.running", "正在进行诊断…"],
  ["localConversation.guidedDiagnostics.inline.viewDiagnostics", "查看诊断"],
  [
    "localConversation.guidedDiagnostics.recommendedStep",
    "{category, select, network {检查网络、VPN 或代理后重试} auth {退出后重新登录，然后在目标工作区中重试} permissions {切换到目标工作区，或请管理员授予所需权限} workspace_setup {运行设置流程或安装缺失的依赖后重试} sandbox_approval {为被拦截的操作请求批准，或使用受支持且无需提升权限的方式} quota_rate_limit {等待限额周期重置、减少请求量，或检查此工作区的用量限额} platform_incident {请稍后重试。如果问题持续出现，请复制诊断详情以寻求支持} unknown {如果问题持续出现，请复制诊断详情} other {如果问题持续出现，请复制诊断详情}}",
  ],
  ["localConversation.guidedDiagnostics.result.category", "可能的原因"],
  ["localConversation.guidedDiagnostics.result.copyHandoff", "复制诊断详情"],
  ["localConversation.guidedDiagnostics.result.evidence", "已检查的依据"],
  ["localConversation.guidedDiagnostics.result.nextStep", "下一步"],
  ["localConversation.guidedDiagnostics.result.occurredAtUtc", "发生时间（UTC）"],
  [
    "localConversation.guidedDiagnostics.result.scope",
    "诊断仅使用此错误、应用提供的详情和 OpenAI 服务状态，不会检查其他日志或本地文件",
  ],
  ["localConversation.guidedDiagnostics.result.status", "OpenAI 服务状态"],
  ["localConversation.guidedDiagnostics.result.threadId", "任务/会话 ID"],
  ["localConversation.guidedDiagnostics.result.title", "诊断完成"],
  ["localConversation.guidedDiagnostics.result.turnId", "轮次 ID"],
  [
    "localConversation.guidedDiagnostics.status.activeIncident",
    "OpenAI 状态页面显示有可能相关的故障：{incidentNames}",
  ],
  [
    "localConversation.guidedDiagnostics.status.activeIncidentWithoutName",
    "OpenAI 状态页面显示有可能相关的故障尚未解决",
  ],
  ["localConversation.guidedDiagnostics.status.noMatchingIncident", "OpenAI 状态页面未显示相关故障"],
  [
    "localConversation.guidedDiagnostics.status.unavailable",
    "无法检查 OpenAI 服务状态，因此 Codex 仅使用了本地错误详情",
  ],
  [
    "localConversation.guidedDiagnostics.summary",
    "{category, select, network {Codex 无法连接到服务} auth {Codex 可能需要你重新登录或切换工作区} permissions {Codex 没有执行此操作的权限} workspace_setup {此工作区可能需要修复} sandbox_approval {Codex 需要获得批准才能执行此操作} quota_rate_limit {这可能是用量限额或请求频率限制导致的} platform_incident {OpenAI 状态页面显示有可能相关的服务故障} unknown {Codex 无法根据现有信息诊断此问题} other {Codex 无法根据现有信息诊断此问题}}",
  ],
  ["localConversation.guidedDiagnostics.value.unavailable", "不可用"],
  ["localConversation.pendingProjectless.retry", "重试"],
  ["localTaskRow.resumeError.retry", "重试"],
  ["notifications.asyncQuestion", "Codex 有个问题"],
  ["plugins.detail.app.reauthRequired", "需要重新连接"],
  ["plugins.detail.app.unavailable", "此应用不可用"],
  ["plugins.detail.appDisconnected", "已断开应用连接"],
  ["plugins.detail.appDisconnectError", "无法断开应用连接"],
  ["plugins.detail.appDisconnectRefreshError", "已断开应用连接，但无法刷新应用列表"],
  ["plugins.incentive.accept", "接受并安装"],
  ["plugins.incentive.accountChanged", "账户或工作区已更改。请关闭此对话框后重试。"],
  ["plugins.incentive.almostThere", "就快完成了！"],
  ["plugins.incentive.consent.installStep", "接受优惠并安装 {pluginName} 插件"],
  [
    "plugins.incentive.consent.sharedLimitsDisclosure",
    "额度将发放到你的工作区。在所有参与活动的插件和工作区中，每人限领一次奖励。奖励受工作区共享限额和可用情况限制。接受优惠不会预留额度。",
  ],
  ["plugins.incentive.consent.title", "安装 {pluginName} 插件"],
  ["plugins.incentive.consent.useStep", "在 Codex 或 ChatGPT Work 中成功使用 {pluginName} 插件"],
  ["plugins.incentive.consent.windowDuration", "接受后，你最多有 {duration} 来完成此流程。"],
  ["plugins.incentive.continue", "继续安装"],
  ["plugins.incentive.dismissCreditTip", "关闭额度提示"],
  ["plugins.incentive.enrollmentConfirmationUnavailable", "无法确认优惠状态。已接受的优惠仍会保留。请重试后再继续安装"],
  [
    "plugins.incentive.hostIdentityMismatch",
    "领取奖励要求此电脑与任务主机使用相同的账户和工作区。你可以不领取奖励直接安装，或关闭此对话框，使用匹配的账户后重试。",
  ],
  [
    "plugins.incentive.installAndUseRewardBadge",
    "安装并使用可获得 {credits, plural, one {# 点额度} other {# 点额度}}",
  ],
  ["plugins.incentive.installWithout", "不领取奖励，直接安装"],
  ["plugins.incentive.loading", "正在检查优惠…"],
  ["plugins.incentive.retry", "重试"],
  ["plugins.incentive.rewardBadge", "{credits, plural, one {# 点额度} other {# 点额度}}"],
  ["plugins.incentive.rewardRequirements", "安装并成功使用 {pluginName} 插件，即可为工作区赚取额度"],
  [
    "plugins.incentive.tryPluginForWorkspaceCredits",
    "在 Work 或 Codex 中试用此插件，即可为你的工作区赚取 {credits, plural, one {# 点额度} other {# 点额度}}。",
  ],
  ["plugins.incentive.unavailable", "此优惠不可用。你仍可安装插件，但无法获得奖励。"],
  [
    "plugins.incentive.workspaceCreditsAdded",
    "已向你的工作区添加 {credits, plural, one {# 点额度} other {# 点额度}}",
  ],
  ["realtimeVoice.reasoningNotice.description", "切换到“轻度”推理以获得更快的语音回复"],
  ["realtimeVoice.reasoningNotice.dismiss", "知道了"],
  ["realtimeVoice.reasoningNotice.useLight", "使用轻度推理"],
  ["requestInputPanel.nextQuestion", "下一个问题"],
  ["requestInputPanel.previousQuestion", "上一个问题"],
  ["safetyBuffering.retryDialogHistoryDescription", "这会替换会话中的当前尝试。已做出的文件更改或其他已执行的操作都会保留。"],
  ["safetyBuffering.retryFailed", "无法使用更快的模型重试"],
  ["sendUserMessageQuestion.answer", "回答问题"],
  ["sendUserMessageQuestion.asking", "正在提问"],
  ["sendUserMessageQuestion.askingMultiple", "正在提出多个问题"],
  ["sendUserMessageQuestion.otherPlaceholder", "或输入你自己的回复"],
  ["sendUserMessageQuestion.sendAgain", "发送更新"],
  ["sendUserMessageQuestion.sendError", "无法发送回复"],
  ["sendUserMessageQuestion.skipCountdown", "跳过，还剩 {seconds, plural, one {# 秒} other {# 秒}}"],
  [
    "settings.browserUse.sitePermissions.requiresApprovalUnavailable",
    "请先将默认权限从“始终允许”改为其他选项，才能要求对单个网站进行批准",
  ],
  ["settings.chatGpt.birthday.ageVerification", "年龄验证"],
  [
    "settings.chatGpt.birthday.description",
    "这有助于我们根据你的情况提供个性化体验，并遵循<privacy>隐私政策</privacy>{under18, select, yes {提供适龄设置} other {提供合适的设置}}",
  ],
  ["settings.chatGpt.birthday.invalid", "出生日期无效"],
  ["settings.chatGpt.birthday.pendingDescription", "你的年龄已验证，即将更新"],
  ["settings.chatGpt.birthday.placeholder", "月 / 日 / 年"],
  ["settings.chatGpt.birthday.refreshError", "年龄验证已完成，但无法刷新你的设置。请尝试再次刷新。"],
  ["settings.chatGpt.birthday.retry", "重新加载"],
  ["settings.chatGpt.birthday.retryRefresh", "重新刷新"],
  ["settings.chatGpt.birthday.updated", "已更新你的出生日期"],
  ["settings.chatGpt.birthday.updateError", "无法更新你的出生日期"],
  [
    "settings.chatGpt.birthday.verificationDescription",
    "为帮助确保 ChatGPT 适合所有人使用，部分设置需要验证年龄。<learnMore>了解更多</learnMore>",
  ],
  ["settings.chatGpt.birthday.verificationError", "无法启动年龄验证。请重试。"],
  ["settings.chatGpt.birthday.verified", "年龄已验证"],
  ["settings.chatGpt.birthday.verify", "验证年龄"],
  ["settings.chatGpt.birthday.verifyDescription", "如需更改，我们需要验证你的年龄"],
  ["settings.chatGpt.birthday.verifyTitle", "验证你的年龄"],
  ["settings.chatGpt.personalization.memories.automatic", "自动管理"],
  ["settings.chatGpt.personalization.memories.automatic.confirm.cancel", "取消"],
  [
    "settings.chatGpt.personalization.memories.automatic.confirm.description",
    "记忆空间用满后，ChatGPT 将无法保存新记忆，回复的个性化程度可能会降低。<learn>了解更多</learn>",
  ],
  ["settings.chatGpt.personalization.memories.automatic.confirm.disable", "关闭"],
  ["settings.chatGpt.personalization.memories.automatic.confirm.title", "关闭自动管理？"],
  ["settings.chatGpt.personalization.memories.automatic.error", "无法更新记忆自动管理设置"],
  ["settings.chatGpt.personalization.memories.prioritize.error", "无法优先使用此记忆"],
  ["settings.chatGpt.personalization.memories.prioritize.success", "已设为优先使用的记忆"],
  ["settings.chatGpt.personalization.memories.usage", "已使用 {memoryUsagePercent}%"],
  [
    "settings.chatGpt.personalization.memories.usage.almostFull",
    "记忆空间用满后，回复的个性化程度可能会降低。删除现有记忆以释放空间",
  ],
  ["settings.chatGpt.personalization.memories.usage.full", "无法保存新记忆，回复的个性化程度可能会降低。删除现有记忆以释放空间"],
  ["settings.chatGpt.personalization.memory.accountUnavailable.description", "无法确认此账户是否可使用记忆功能"],
  ["settings.chatGpt.personalization.memory.unavailable", "记忆控制选项不可用"],
  ["settings.chatGpt.personalization.memory.unavailable.description", "无法加载你的记忆设置。请重试"],
  ["settings.chatGpt.personalization.memory.unavailable.retry", "重试"],
  ["settings.chatGpt.personalization.memory.workspaceDisabled", "此工作区已禁用记忆功能"],
  ["settings.import.autosync.cancel", "取消"],
  ["settings.import.autosync.futureSyncs.v2", "更改将应用于今后的同步。已导入的内容会保留在 {appName} 中"],
  ["settings.import.autosync.noCategories", "请至少选择一个类别。如需停止同步，请关闭“保持导入内容同步”"],
  ["settings.import.autosync.noneSelected", "未选择内容"],
  ["settings.import.autosync.pluginsDescription", "插件内的技能和 MCP 服务器会随插件一起同步"],
  ["settings.import.autosync.save", "保存"],
  ["settings.import.autosync.saveError", "无法保存同步偏好设置。请重试"],
  ["settings.import.autosync.settingsDescription", "Cowork 工具会与设置一起同步"],
  ["settings.import.autosync.toggleError", "无法更改自动同步设置。请重试"],
  ["settings.mcp.appConnectConsent.sitePermissions", "允许 {origin}："],
  ["settings.usage.subscriptionSharing.apps.limitReached", "已达到应用每周限额"],
  ["settings.usage.subscriptionSharing.apps.loadError", "无法加载应用限额"],
  ["settings.usage.subscriptionSharing.apps.retry", "重试"],
  ["settings.usage.subscriptionSharing.apps.usageUnavailable", "用量不可用"],
  ["shareDialog.thread.copiedToast.publicConversationDescription", "任何拥有此链接的人都可以查看此会话"],
  ["shareDialog.thread.copiedToast.publicResponseDescription", "任何拥有此链接的人都可以查看此回复"],
  ["sidebarElectron.usageAlert.toggleDetails", "用量详情"],
  ["sidebarElectron.usageAlert.windowRemaining", "剩余 {remaining}"],
  ["sidebarElectron.usageAlert.windowResetDateTime", "将于 {date} {time} 重置"],
  ["sidebarElectron.usageAlert.windowResetTime", "将于 {time} 重置"],
  ["signInWithChatGPTConsent.resourcePermission.adsRead", "查看广告管理平台数据"],
  ["signInWithChatGPTConsent.resourcePermission.adsWrite", "管理广告管理平台数据"],
  ["signInWithChatGPTConsent.resourcePermission.chatgptAllowance", "使用你的 ChatGPT 额度"],
  ["signInWithChatGPTConsent.resourcePermission.chatgptPlugins", "使用你已连接的 ChatGPT 应用"],
  ["signInWithChatGPTConsent.resourcePermission.identity", "身份信息"],
  ["signInWithChatGPTConsent.resourcePermission.offlineAccess", "离线访问"],
  ["signInWithChatGPTConsent.resourcePermission.resourceInvoke", "资源操作"],
  [
    "thread.agreeToTermsNoAuth-may-06",
    "继续即表示你同意我们的<termsLink>条款</termsLink>，并已阅读<privacyLink>隐私政策</privacyLink>。",
  ],
  [
    "thread.agreeToTermsNoAuthKorea-may-06",
    "继续即表示你同意我们的<termsLink>条款</termsLink>，并已阅读<privacyLink>隐私政策</privacyLink>及其<koreaAddendumLink>韩国附录</koreaAddendumLink>。",
  ],
  // Remaining application UI gaps audited in 26.901.51231.
  ["appShell.detachedWindow.untitledSource", "未命名任务"],
  ["artifactSession.endResource.spreadsheetSubtitle", "实时电子表格"],
  ["artifactSession.endResource.untitledSpreadsheet", "实时电子表格"],
  ["artifactSession.loading", "正在打开实时电子表格…"],
  ["artifactTab.docx.hideRedlines", "隐藏修订标记"],
  ["artifactTab.docx.showRedlines", "显示修订标记"],
  ["assistantMessage.autoReviewStats.expandedCommand", "命令"],
  ["assistantMessage.autoReviewStats.noRationale", "自动审核未提供理由"],
  ["assistantMessage.autoReviewStats.rejectedLabel", "自动审核统计（已拒绝 {count, number} 次）"],
  ["browserSidebarDesignEditor.annotationControls.reference", "{property} 的参考"],
  ["chatgpt.automation.nextRun", "下次运行：{nextRunAt, date, ::MMMd} {nextRunAt, time, short}"],
  ["chatgpt.automation.oneTimeSchedule", "仅一次"],
  ["chatgpt.new-onboarding.all-done-2", "一切就绪"],
  ["chatgpt.new-onboarding.continue", "继续"],
  ["chatgpt.pythonExecution.downloadOutput", "{type, select, chart {下载图表} other {下载图片}}"],
  ["chatgpt.pythonExecution.expandOutput", "{type, select, chart {展开图表} other {展开图片}}"],
  ["chatgpt.pythonExecution.imageAlt", "分析输出 {number}"],
  ["chatgpt.pythonExecution.imageLoading", "正在加载分析图片…"],
  ["chatgpt.pythonExecution.resultLabel", "结果"],
  [
    "chatgpt.pythonExecution.status",
    "{status, select, running {正在分析} completed {分析完成} error {分析出错} other {分析已暂停}}",
  ],
  [
    "chatgptConversations.bigPaste.fileName",
    "{count, plural, one {粘贴的文本.txt} other {粘贴的文本（{count}）.txt}}",
  ],
  ["chatgptConversations.composer.libraryFile.sharedBy", "由 {name} 分享"],
  [
    "chatgptConversations.home.temporaryDescription.personalization",
    "{personalized, select, true {此聊天可以引用记忆、插件和自定义指令，但不会出现在你的历史记录中} other {此聊天将忽略记忆、插件和自定义指令，并且不会出现在你的历史记录中}}",
  ],
  ["chatgptConversations.loadingWorkMessage", "正在处理"],
  ["chatgptConversations.modelPicker.internalModelsLabel", "内部模型"],
  ["chatgptConversations.sidebar.projects.loading", "正在加载项目…"],
  ["chatgptConversations.sources.memory.actions", "记忆操作"],
  ["chatgptConversations.sources.memory.attribution.generalMemory", "记忆"],
  ["chatgptConversations.sources.memory.attribution.userInstructions", "自定义指令"],
  ["chatgptConversations.sources.memory.attribution.userMemory", "已保存的记忆"],
  ["chatgptConversations.sources.showLess", "收起"],
  ["chatgptConversations.sources.showMore", "{count, plural, one {还有 # 项} other {还有 # 项}}"],
  [
    "chatgptConversations.sources.showMore.ariaLabel",
    "显示另外 {count, plural, one {# 项} other {# 项}}",
  ],
  ["chatgptConversations.summaryPanel.sources.memory.feedback.notRelevant", "不相关"],
  ["chatgptConversations.summaryPanel.sources.memory.feedback.relevant", "相关"],
  ["chatgptConversations.temporaryChat.personalized.description.memoryDisabled", "此聊天可以引用插件和自定义指令"],
  [
    "chatgptConversations.temporaryChat.unpersonalized.description.memoryDisabled",
    "此聊天将忽略插件和自定义指令",
  ],
  ["chatgptConversations.thinkingMode.label", "思考"],
  ["chatgptConversations.thinkingMode.tooltip", "获得更智能的回答"],
  ["chatgptProjectHome.composer.placeholder", "在 {projectName} 中新建聊天"],
  ["chatgptProjectHome.composer.placeholderWithoutName", "在此项目中新建聊天"],
  ["codex.chatGptSearch.filterAll", "全部"],
  ["codex.chatGptSearch.filterChats", "聊天"],
  ["codex.chatGptSearch.filterDocuments", "文档"],
  ["codex.chatGptSearch.filterImages", "图片"],
  ["codex.chatGptSearch.filterProjects", "项目"],
  ["codex.chatGptSearch.filterTabsLabel", "搜索结果类型"],
  ["codex.command.copyPageLink", "复制页面链接"],
  ["codex.command.hideMiniOverlay", "隐藏迷你窗口"],
  ["codex.command.showMiniOverlay", "显示迷你窗口"],
  ["codex.commandDescription.copyPageLink", "将当前页面的链接复制到剪贴板"],
  ["codex.commandMenu.browserTabs", "浏览器标签页"],
  ["codex.commandMenu.chatGptSearch.dateToday", "今天"],
  ["codex.commandMenu.chatGptSearch.dateYesterday", "昨天"],
  ["codex.composer.appMessageContext", "应用消息上下文"],
  ["codex.mcpApp.imageMessage", "从 {appName} 分享了一张图片"],
  ["codex.sidebarCreditBalance.amount", "{balance} 点额度"],
  ["codex.sidebarUsage.monthlyCreditLimit", "每月额度限额"],
  [
    "codex.upsellBanner.referral.workspace.headline",
    "购买额度，或邀请同事使用 ChatGPT 桌面版。同事发送第一条消息后，你的工作区即可获得额度。",
  ],
  [
    "codex.upsellBanner.referral.workspaceMemberCredits.headline",
    "通知所有者添加额度，或邀请同事使用 ChatGPT 桌面版。同事发送第一条消息后，你的工作区即可获得额度。",
  ],
  ["codex.visualization.annotationApplyChanges", "应用更改"],
  ["codex.visualization.annotationChangesContext", "可视化更改"],
  ["codex.writingBlock.actions.moreActions", "更多操作"],
  ["codex.writingBlock.documentTabTitle", "文档"],
  ["codex.writingBlock.library.loading", "正在加载文档…"],
  ["codex.writingBlock.libraryBreadcrumb", "资料库"],
  ["codex.writingBlock.openEditor", "打开编辑器"],
  ["composer.dictation.starting.aria", "正在启动听写；点击取消"],
  ["composer.dictation.starting.tooltip", "正在启动听写…"],
  [
    "composer.intelligencePicker.fastMode.advanced.subtitle.withMultiplier",
    "{speedMultiplier, number} 倍速度，用量更高",
  ],
  [
    "composer.intelligencePicker.fastMode.speed.tooltip.withMultiplier",
    "{speedMultiplier, number} 倍速度",
  ],
  ["composer.suggestionList.loading", "正在加载建议"],
  ["composer.workMode.plugins.loadingRecommendations", "正在加载插件…"],
  ["consumerAnalyticsPreview.chats.chat", "聊天"],
  ["consumerAnalyticsPreview.chats.loading", "正在加载聊天用量…"],
  ["consumerAnalyticsPreview.chats.retry", "重试"],
  ["consumerAnalyticsPreview.chats.toggleRows", "{expanded, select, yes {收起} other {展开更多}}"],
  ["consumerAnalyticsPreview.history.period", "用量历史日期范围"],
  ["consumerAnalyticsPreview.limitHistory.description", "查看各项套餐限额的使用情况"],
  ["consumerAnalyticsPreview.limitHistory.empty", "此日期范围内没有限额周期"],
  [
    "consumerAnalyticsPreview.limitHistory.limitHeading",
    "{limit, select, fiveHour {5 小时限额} other {每周限额}}",
  ],
  ["consumerAnalyticsPreview.limitHistory.loading", "正在加载限额历史记录…"],
  ["consumerAnalyticsPreview.limitHistory.noContributions", "此明细中没有可显示的用量"],
  [
    "consumerAnalyticsPreview.limitHistory.openPeriod",
    "{limit, select, fiveHour {5 小时周期} other {每周周期}}：{start} 至 {end} UTC{current, select, yes {，截至上次更新时为当前周期} other {}}",
  ],
  ["consumerAnalyticsPreview.limitHistory.partial", "部分周期暂不可用"],
  ["consumerAnalyticsPreview.limitHistory.period", "周期"],
  ["consumerAnalyticsPreview.limitHistory.retry", "重试"],
  ["consumerAnalyticsPreview.limitHistory.sharedGroup", "套餐用量历史分组"],
  [
    "consumerAnalyticsPreview.limitHistory.tableName",
    "{limit, select, fiveHour {5 小时限额} other {每周限额}}",
  ],
  ["consumerAnalyticsPreview.limitHistory.title", "套餐用量历史"],
  ["consumerAnalyticsPreview.limitHistory.toggleRows", "{expanded, select, yes {收起} other {展开更多}}"],
  ["consumerAnalyticsPreview.limitHistory.used", "已用限额百分比"],
  [
    "consumerUsage.breakdown.label",
    "{breakdown, select, feature {按功能} model {按模型} surface {按使用界面} other {按轮次启动方式}}",
  ],
  ["consumerUsage.chart.turnStartsDescription", "按各轮次的启动方式显示全部用量"],
  ["consumerUsage.chats.empty", "此设备上没有最近的聊天"],
  ["consumerUsage.chats.freshness", "用量估算截至 {date} UTC；最近的活动可能尚未计入"],
  [
    "consumerUsage.chats.funding",
    "{source, select, included_plan {套餐用量} plan_and_credits {套餐用量和额度} credits {额度} none {未消耗套餐用量或额度} other {扣费来源不可用}}",
  ],
  ["consumerUsage.chats.incompleteCoverage", "部分聊天或用量未计入，此排名可能不完整"],
  [
    "consumerUsage.chats.metric",
    "{metric, select, five_hour_limit_percent {5 小时限额占比} weekly_limit_percent {每周限额占比} other {已用额度}}",
  ],
  [
    "consumerUsage.chats.recentDescription",
    "显示过去 30 天内在此设备上活跃的最多 100 个聊天，按累计用量排名。百分比以当前完整限额为基准，可能超过 100%。",
  ],
  ["consumerUsage.chats.subagents", "{count, plural, one {# 个子代理} other {# 个子代理}}"],
  ["consumerUsage.chats.title", "用量最高的聊天"],
  ["consumerUsage.chats.untitled", "未命名聊天"],
  ["consumerUsage.history.breakdown", "用量历史分组"],
  ["consumerUsage.history.chartLabel", "按天比较总用量，包括套餐用量和额度。"],
  ["consumerUsage.history.description", "查看用量去向，以及活动随时间的变化"],
  ["consumerUsage.history.title", "总用量历史"],
  ["consumerUsage.limitHistory.incompleteAccounting", "部分用量不可用，此周期的数据可能不完整"],
  [
    "consumerUsage.limitHistory.snapshotCoverage",
    "用量截至 {asOf}{coverage, select, available {；数据自 {start} 起可用} other {}}。{approximate, select, yes {用量和周期边界为估算值；最近的活动可能尚未计入} other {最近的活动可能尚未计入}}",
  ],
  ["consumerUsage.limitHistory.tasksOnly", "按轮次启动方式分组时仅包含任务；百分比以整个周期的限额为基准"],
  [
    "consumerUsage.series.recordedSource",
    "{key, select,\n        agent_created_thread {代理创建的任务}\n        agent_forked_thread {代理分叉的任务}\n        ambient_suggestion_safety {后台建议安全检查}\n        ambient_suggestion_task {后台建议任务}\n        ambient_suggestions {主动建议}\n        automated_review {自动审核}\n        automation {自动化任务}\n        avatar_quick_chat {头像快捷聊天}\n        chatgpt_handoff {ChatGPT 交接}\n        code_review {代码审查}\n        codex_replay {Codex 回放}\n        codex_web_code_review {Codex 网页版代码审查}\n        codex_web_pr {Codex 网页版拉取请求}\n        codex_web_qa {Codex 网页版问答}\n        codex_web_security_review {Codex 网页版安全审查}\n        commit_message {提交说明}\n        commit_pull_request_message {提交与拉取请求说明}\n        conversation_digest {会话摘要}\n        conversational_onboarding {对话式入门引导}\n        dictation_cleanup {听写文本整理}\n        guardian_classifier {安全审核分类器}\n        guardian_review {安全审核}\n        implement_todo {实现待办事项}\n        inline_edit {行内编辑}\n        local_environment_configuration {本地环境配置}\n        mcp_app_follow_up {MCP 应用后续处理}\n        mcp_extension_host {MCP 扩展宿主}\n        memory_consolidation {记忆整合}\n        onboarding_checklist {入门清单}\n        pull_request_fix_automation {拉取请求自动修复}\n        pull_request_message {拉取请求说明}\n        realtime_voice {实时语音}\n        security_remediation {安全修复}\n        security_scan {安全扫描}\n        subagent {子代理}\n        system {系统}\n        thread_description {任务描述}\n        thread_summary {任务摘要}\n        thread_title {任务标题}\n        thread_title_reconsideration {任务标题重新评估}\n        title {标题}\n        title_generation {标题生成}\n        user {任务}\n        voice_chat {语音聊天}\n        worktree_setup_auto_fix {工作树设置自动修复}\n        vscode {VS Code}\n        web {网页版}\n        work_web {Work 网页版}\n        work_mobile {Work 移动版}\n        desktop_app {桌面应用}\n        work_desktop {Work 桌面版}\n        agent_identity {工作区代理}\n        unknown {未知}\n      other {{key}}\n    }",
  ],
  [
    "consumerUsage.series.turnTrigger",
    "{trigger, select,\n        user {用户消息}\n        composer {用户消息}\n        composer_queue {排队消息}\n        composer_queue_run_now {立即运行的排队消息}\n        automation_cron_scheduled {定时自动化任务}\n        automation_cron_run_now {立即运行的自动化任务}\n        automation_heartbeat_scheduled {定时后续处理}\n        automation_heartbeat_run_now {立即运行的后续处理}\n        app_tool_create_thread {代理创建的任务}\n        app_tool_send_message {代理后续处理}\n        app_update_resume {应用更新后恢复的任务}\n        artifact_comment {内容评论}\n        avatar_quick_chat {头像快捷聊天}\n        avatar_follow_up {头像后续处理}\n        avatar_implement_plan {头像计划执行}\n        capacity_retry_automatic {容量不足时自动重试}\n        capacity_retry_manual {容量不足时手动重试}\n        chatgpt_handoff {ChatGPT 交接}\n        code_review {代码审查}\n        codex_replay {Codex 回放}\n        conversational_onboarding {入门引导}\n        conversational_onboarding_revert {入门引导重置}\n        edit_user_message {已编辑的消息}\n        image_edit {图片编辑}\n        implement_todo {待办事项实现}\n        local_environment_configuration {环境配置}\n        mcp_app_follow_up {应用后续处理}\n        notification_reply {通知回复}\n        onboarding_checklist {入门清单}\n        plan_feedback {计划反馈}\n        plan_implementation {计划执行}\n        plugin_suggestion_connected {已连接的插件建议}\n        pull_request_fix_setup {拉取请求修复设置}\n        queued_side_chat {排队中的侧边聊天}\n        resume_interrupted_task {已恢复的任务}\n        safety_buffer_retry {安全重试}\n        send_user_message_async_question {代理问题的回复}\n        security_remediation {安全修复}\n        security_scan {安全扫描}\n        side_chat {侧边聊天}\n        slides_outline {幻灯片大纲}\n        thread_handoff {任务交接}\n        visualization_follow_up {可视化后续处理}\n        visualization_repair {可视化修复}\n        visualization_sites_handoff {可视化交接}\n        goal {目标}\n        queue {队列}\n        retry {重试}\n        realtime {实时}\n        persistent_mode {持续模式}\n        unknown {未知}\n        other {{key}}\n      }",
  ],
  ["electron.onboarding.login.apikey.open.explicit.welcomeV2", "使用 API 密钥登录"],
  ["gitlabMergeRequest.open", "在 GitLab 中打开合并请求"],
  ["inbox.automations.targetThread.required", "为此任务选择一个聊天"],
  ["libraryNext.actions.download", "下载"],
  ["libraryNext.actions.menu", "打开 {name} 的操作菜单"],
  ["libraryNext.actions.rename", "重命名"],
  ["libraryNext.create.document", "文档"],
  ["libraryNext.create.folder", "文件夹"],
  ["libraryNext.create.image", "图片"],
  ["libraryNext.create.new", "新建"],
  ["libraryNext.create.presentation", "演示文稿"],
  ["libraryNext.create.spreadsheet", "电子表格"],
  ["libraryNext.create.upload", "上传文件"],
  ["libraryNext.create.uploadMenu", "上传文件"],
  [
    "libraryNext.filters.clearCategory",
    "{category, select, images {清除图片筛选} documents {清除文档筛选} spreadsheets {清除电子表格筛选} presentations {清除演示文稿筛选} other {清除 PDF 筛选}}",
  ],
  ["libraryNext.filters.documents", "文档"],
  ["libraryNext.filters.fileType", "文件类型"],
  ["libraryNext.filters.generated", "已生成"],
  ["libraryNext.filters.images", "图片"],
  [
    "libraryNext.filters.openWithCount",
    "{activeFilterCount, plural, =0 {打开筛选条件} one {打开筛选条件，已启用 # 项} other {打开筛选条件，已启用 # 项}}",
  ],
  ["libraryNext.filters.pdfs", "PDF 文件"],
  ["libraryNext.filters.presentations", "演示文稿"],
  ["libraryNext.filters.source", "来源"],
  ["libraryNext.filters.spreadsheets", "电子表格"],
  ["libraryNext.filters.uploaded", "已上传"],
  ["libraryNext.items.calendarActivity", "{opened, select, true {打开于 {time}} other {修改于 {time}}}"],
  [
    "libraryNext.items.contentsCount",
    "{items, plural, one {# 个项目} other {# 个项目}}和{folders, plural, one {# 个文件夹} other {# 个文件夹}}",
  ],
  ["libraryNext.items.count", "{count, plural, one {# 个项目} other {# 个项目}}"],
  ["libraryNext.items.foldersCount", "{count, plural, one {# 个文件夹} other {# 个文件夹}}"],
  ["libraryNext.items.relativeActivity", "{opened, select, true {{time}前打开} other {{time}前修改}}"],
  ["libraryNext.rename.itemName", "{kind, select, directory {文件夹名称} other {文件名}}"],
  [
    "libraryNext.results.dateHeading",
    "{kind, select, suggested {最近活动} shared {分享日期} deleted {删除时间} other {修改时间}}",
  ],
  ["libraryNext.results.emptyFolder", "此文件夹为空。"],
  [
    "libraryNext.results.emptyTabDescription",
    "{tab, select, images {你使用 ChatGPT 创建的图片会显示在这里。} folders {创建文件夹以整理资料库中的项目。} other {你使用 ChatGPT 制作的图片、文档等内容会显示在这里。}}",
  ],
  [
    "libraryNext.results.emptyTabTitle",
    "{tab, select, images {创建你的第一张图片} folders {创建你的第一个文件夹} other {创作新内容}}",
  ],
  ["libraryNext.results.folders", "文件夹"],
  ["libraryNext.results.items", "项目"],
  ["libraryNext.results.name", "名称"],
  ["libraryNext.results.noFilesFound", "未找到文件"],
  ["libraryNext.results.noFilesYet", "暂无文件"],
  ["libraryNext.results.partial", "部分来源无法搜索。请重试以查看所有结果。"],
  ["libraryNext.results.retry", "重试"],
  ["libraryNext.results.sharedEmptyDescription", "与你分享的文件会显示在这里"],
  ["libraryNext.results.sharedEmptyTitle", "文件夹为空"],
  ["libraryNext.results.size", "大小"],
  ["libraryNext.results.uploadDescription", "上传文件，开始建立你的资料库。"],
  ["libraryNext.search.label", "搜索资料库"],
  ["libraryNext.selection.actions", "所选项目操作"],
  ["libraryNext.selection.allAction", "{partial, select, true {清除选择} other {全选}}"],
  ["libraryNext.selection.chat", "开始聊天"],
  ["libraryNext.selection.clear", "清除选择"],
  ["libraryNext.selection.count", "{count, plural, one {已选择 # 项} other {已选择 # 项}}"],
  ["libraryNext.selection.item", "选择 {name}"],
  ["libraryNext.settings.hidden", "显示隐藏文件"],
  ["libraryNext.settings.label", "设置"],
  ["libraryNext.settings.manage", "管理"],
  ["libraryNext.settings.provider", "显示 {provider}"],
  ["libraryNext.settings.trash", "回收站"],
  ["libraryNext.tabs.all", "全部"],
  ["libraryNext.tabs.folders", "文件夹"],
  ["libraryNext.tabs.label", "资料库分区"],
  ["libraryNext.tabs.suggested", "推荐"],
  ["libraryNext.title.library", "资料库"],
  ["libraryNext.title.search", "搜索"],
  ["libraryNext.title.trash", "回收站"],
  ["libraryNext.view.grid", "网格视图"],
  ["libraryNext.view.list", "列表视图"],
  ["quickChat.mainConversation", "聊天"],
  ["realtimeVoiceDebug.disabled", "已禁用"],
  ["realtimeVoiceDebug.effectiveDisabled", "已禁用"],
  ["realtimeVoiceDebug.effectiveEnabled", "已启用"],
  ["realtimeVoiceDebug.enabled", "已启用"],
  ["realtimeVoiceDebug.forcingOff", "强制关闭中"],
  ["realtimeVoiceDebug.off", "关闭"],
  ["review.fileSource.copyAbsolutePath", "绝对路径"],
  ["review.fileSource.copyPathButton", "复制路径"],
  ["review.fileSource.copyPathOptions", "复制路径选项"],
  ["review.fileSource.copyPathRelativeToProject", "相对于项目"],
  ["review.fileSource.copyPathRelativeToRepo", "相对于仓库"],
  ["review.fileSource.copyProjectRelativePathButton", "复制相对于项目的路径"],
  ["review.fileSource.copyRepoRelativePathButton", "复制相对于仓库的路径"],
  ["review.fileSource.openInGitHubButton", "在 GitHub 中打开"],
  ["serviceTier.fast.description.2x", "2 倍速度，用量更高"],
  ["settings.automations.destination.ariaLabel", "定时任务目标"],
  ["settings.automations.destination.newChatEachRun", "每次运行新建聊天"],
  ["settings.automations.destination.newDedicatedChat", "为此任务新建聊天"],
  ["settings.browserUse.sitePermissions.approvalValue.alwaysAllow", "始终允许"],
  ["settings.browserUse.sitePermissions.approvalValue.requiresApproval", "需要批准"],
  ["settings.browserUse.sitePermissions.inheritedDescription", "使用默认权限"],
  ["settings.browserUse.sitePermissions.value.useDefault", "使用默认值"],
  [
    "settings.chatGpt.personalization.instructions.description",
    "为所有聊天提供额外的指令和背景信息。<learn>了解更多</learn>",
  ],
  [
    "settings.chatGpt.personalization.memories.deprioritized.chatGpt",
    "ChatGPT 于 {date} 降低了此记忆的优先级。",
  ],
  ["settings.chatGpt.personalization.memories.deprioritized.user", "你于 {date} 降低了此记忆的优先级。"],
  ["settings.chatGpt.personalization.memories.filter", "筛选记忆"],
  ["settings.chatGpt.personalization.memories.filter.all", "全部"],
  ["settings.chatGpt.personalization.memories.filter.health", "健康"],
  ["settings.chatGpt.personalization.memories.filter.title", "筛选"],
  ["settings.chatGpt.personalization.memories.health", "健康"],
  ["settings.chatGpt.personalization.memories.health.tooltip", "此记忆仅会在健康聊天中被引用。"],
  ["settings.chatGpt.personalization.memories.prioritize", "优先使用此记忆"],
  ["settings.chatGpt.personalization.memories.savedFromChat", "于 {date} 从某次<chat>聊天</chat>中保存。"],
  ["settings.chatGpt.personalization.memories.savedOn", "保存于 {date}。"],
  ["settings.chatGpt.personalization.memory.description", "配置 ChatGPT 管理记忆的方式。<learn>了解更多</learn>"],
  [
    "settings.chatGpt.personalization.memory.enabled.description.learnMore",
    "允许 ChatGPT 根据你的聊天、文件和已连接的应用提供个性化体验。<learn>了解更多</learn>",
  ],
  ["settings.chatGpt.personalization.memory.history.enabled", "引用聊天历史"],
  [
    "settings.chatGpt.personalization.memory.history.enabled.all.description",
    "允许 ChatGPT 在回复时引用所有过往会话",
  ],
  ["settings.chatGpt.personalization.memory.history.enabled.ariaLabel", "引用聊天历史"],
  [
    "settings.chatGpt.personalization.memory.history.enabled.recent.description",
    "允许 ChatGPT 在回复时引用最近的会话",
  ],
  ["settings.chatGpt.personalization.memory.saved.enabled", "引用已保存的记忆"],
  ["settings.chatGpt.personalization.memory.saved.enabled.ariaLabel", "引用已保存的记忆"],
  ["settings.chatGpt.personalization.memory.saved.enabled.description", "允许 ChatGPT 在回复时保存和使用记忆"],
  ["settings.chatGpt.personalization.memory.saved.manage", "已保存的记忆"],
  ["settings.chatGpt.personalization.memory.saved.manage.description", "查看和管理 ChatGPT 记住的关于你的信息"],
  [
    "settings.chatGpt.personalization.memory.summary.description.savedMemories",
    "查看 ChatGPT 对你的了解概览。你仍可管理之前<memories>保存的记忆</memories>",
  ],
  [
    "settings.chatGpt.security.advancedProtection.description",
    "使用更强的登录保护和额外的安全措施，帮助防止他人未经授权访问你的账户",
  ],
  ["settings.chatGpt.security.advancedProtection.enabled", "已启用高级账户安全保护"],
  ["settings.chatGpt.security.advancedProtection.enroll", "在 ChatGPT 中启用"],
  ["settings.chatGpt.security.advancedProtection.manage", "在 ChatGPT 中管理"],
  ["settings.chatGpt.security.advancedProtection.title", "高级账户安全保护"],
  ["settings.chatGpt.security.password.advancedProtectionDescription", "启用高级账户安全保护期间，密码登录不可用"],
  ["settings.chatGpt.security.password.title", "密码"],
  ["settings.chatGpt.voice.description", "选择语音聊天和朗读使用的声音"],
  ["settings.import.autosync.allCategories", "同步所有类别"],
  ["settings.import.autosync.allCategoriesDescription", "包含今后发现的类别"],
  ["settings.import.autosync.allCategoriesSummary", "所有类别，包括新增类别"],
  ["settings.import.autosync.chatsOnly", "仅聊天"],
  ["settings.import.autosync.commandsDescription", "作为技能导入"],
  ["settings.import.autosync.customizeDescription", "应用于所有已连接的来源和项目"],
  ["settings.import.autosync.selectedCount", "已选择 {count} 个类别"],
  ["settings.import.autosync.showAllCategories", "显示所有类别"],
  ["settings.import.autosync.showAllCategoriesDescription", "出现新类别时选择要同步的内容"],
  ["settings.import.syncCategory.agents", "代理"],
  ["settings.import.syncCategory.chats", "聊天"],
  ["settings.import.syncCategory.commands", "命令"],
  ["settings.import.syncCategory.hooks", "钩子（Hooks）"],
  ["settings.import.syncCategory.instructions", "指令"],
  ["settings.import.syncCategory.mcpServers", "MCP 服务器"],
  ["settings.import.syncCategory.memory", "记忆"],
  ["settings.import.syncCategory.plugins", "插件"],
  ["settings.import.syncCategory.settings", "设置"],
  ["settings.import.syncCategory.skills", "技能"],
  ["settings.nav.consumerView", "个人用户视图"],
  ["settings.section.consumerView", "个人用户视图"],
  ["settings.usage.billing.chart.legend.isolate", "双击以仅显示此项"],
  ["settings.usage.billing.chart.legend.showAll", "双击以显示全部"],
  [
    "settings.usage.billing.chart.legend.totalUsagePeriodSummary",
    "{series} · 占总用量的 {share} · {period} UTC",
  ],
  [
    "settings.usage.billing.chart.tooltip.creditAmount",
    "{value, plural, one {# 点额度} other {# 点额度}}",
  ],
  ["settings.usage.billing.chart.tooltip.messages", "{value, plural, one {# 条消息} other {# 条消息}}"],
  ["settings.usage.billing.chart.tooltip.totalUsageShare", "占总用量的比例"],
  ["settings.usage.billing.credits.consumer.history.periodLabel", "额度历史时间范围"],
  ["settings.usage.billing.credits.consumer.history.title", "额度历史"],
  ["settings.usage.billing.messages.breakdownLabel", "按模型或使用界面对消息分组"],
  ["settings.usage.billing.messages.chartLabel", "消息"],
  ["settings.usage.billing.messages.empty", "此时段内没有消息"],
  ["settings.usage.billing.messages.periodLabel", "消息时间范围"],
  ["settings.usage.billing.messages.sectionTitle", "消息"],
  ["settings.usage.billing.messages.subtitle", "跟踪已发送消息数量随时间的变化"],
  ["settings.usage.billing.messages.title", "消息"],
  ["settings.usage.credit.balance.loading", "正在加载额度"],
  ["settings.usage.enterprise.consumerOverride.subtitle", "以个人用户仪表盘形式显示你在此工作区中的用量"],
  ["settings.usage.subscriptionSharing.apps.empty", "没有应用正在共享你的订阅"],
  ["settings.usage.subscriptionSharing.apps.limit", "限额"],
  ["settings.usage.subscriptionSharing.apps.limitLabel", "{app} 的每周限额：{limit, number, percent}"],
  ["settings.usage.subscriptionSharing.apps.loading", "正在加载应用限额…"],
  ["settings.usage.subscriptionSharing.apps.remainingLabel", "{app} 本周剩余用量"],
  ["settings.usage.subscriptionSharing.apps.title", "应用限额"],
  ["thinkingShimmer.typing", "正在输入…"],
  ["threadHeader.continueActions", "继续方式"],
  ["threadHeader.continueIntoLocal", "在新聊天中继续"],
  ["threadHeader.continueIntoSameWorktree", "在同一工作树中继续"],
  ["threadHeader.continueIntoWorktree", "在新工作树中继续"],
  ["threadWorkspace.layout.closeNewTab", "关闭新标签页"],
  ["threadWorkspace.layout.fillChat", "聊天填满视图"],
  ["threadWorkspace.layout.fillContent", "内容填满视图"],
  ["threadWorkspace.layout.fillView", "填满视图"],
  ["threadWorkspace.layout.fullscreenModifierHint", "全屏显示内容 · 按住 {modifier} 点击以显示聊天"],
  ["threadWorkspace.layout.restoreSplit", "恢复分栏"],
  [
    "threadWorkspace.newTab.artifact.fileType",
    "{fileType, select, artifactDocument {文档} document {文档} image {图片} pdf {PDF 文件} presentation {演示文稿} spreadsheet {电子表格} website {网站} other {文件}}",
  ],
  ["threadWorkspace.newTab.plugins.heading", "插件和 MCP"],
  ["visualization.annotationControls.close", "关闭设计控件"],
  ["visualization.annotationControls.note", "描述更改"],
  ["visualization.annotationControls.notePlaceholder", "描述这些更改…"],
  ["visualization.annotationControls.open", "调整可视化内容"],
  ["visualization.annotationControls.resetAll", "全部重置"],
  ["visualization.annotationControls.resizeHeight", "调整设计控件高度"],
  ["visualization.annotationControls.resizeWidth", "调整设计控件宽度"],
  ["visualization.annotationControls.sendChanges", "发送更改"],
  ["visualization.annotationControls.title", "设计控件"],
  ["widgets.audioPlayer.audio", "音频"],
  ["widgets.audioPlayer.download", "下载 {title}"],
  ["widgets.audioPlayer.pause", "暂停 {title}"],
  ["widgets.audioPlayer.play", "播放 {title}"],
  ["widgets.audioPlayer.playbackSpeed", "播放速度"],
  ["widgets.audioPlayer.seek", "调整 {title} 的播放进度"],
  ["widgets.audioPlayer.skipBack", "后退 {seconds} 秒"],
  ["widgets.audioPlayer.skipForward", "前进 {seconds} 秒"],
  ["widgets.baseCarousel.label", "轮播"],
  ["widgets.baseCarousel.nextItems", "下一组轮播项目"],
  ["widgets.baseCarousel.previousItems", "上一组轮播项目"],
  ["widgets.cardCarousel.goToArticle", "前往文章"],
  ["widgets.cardCarousel.nextCards", "下一组卡片"],
  ["widgets.cardCarousel.nextCardsInCarousel", "{carouselLabel} 中的下一组卡片"],
  ["widgets.cardCarousel.previousCards", "上一组卡片"],
  ["widgets.cardCarousel.previousCardsInCarousel", "{carouselLabel} 中的上一组卡片"],
  ["widgets.debug.hideCurrentState", "隐藏当前状态"],
  ["widgets.debug.nextState", "下一个状态"],
  ["widgets.debug.previousState", "上一个状态"],
  ["widgets.debug.selectedState", "所选状态"],
  ["widgets.debug.showCurrentState", "显示当前状态"],
  ["widgets.debug.state", "状态"],
  ["widgets.debug.unableToSerializeSelectedState", "无法序列化所选状态。"],
  ["widgets.hermes.calendarEvent.moreAttendees", "另有 {count} 位参加者"],
  ["widgets.hermes.calendarEvent.singleTime", "{date} {time}"],
  ["widgets.hermes.calendarEvent.timeRange", "{date} {startTime} 至 {endTime}"],
  ["widgets.hermes.elicitation.connectorAuth.title", "{agentName} 需要访问权限才能继续"],
  ["widgets.hermes.elicitation.toolApproval.title", "{agentName} 需要你的许可才能继续"],
  ["widgets.hermes.genericResponse.viewFullscreen", "全屏查看"],
  ["widgets.hermes.genericTool.details", "详情"],
  ["widgets.hermes.genericTool.read", "读取"],
  ["widgets.hermes.genericTool.request", "请求"],
  [
    "widgets.hermes.genericTool.runToolDescription",
    "{agentName} 想要使用 {connectorName} 运行 {toolName}。",
  ],
  ["widgets.hermes.genericTool.viewFullscreen", "全屏查看"],
  ["widgets.hermes.genericTool.write", "写入"],
  ["widgets.hermes.googleCalendarCreate.create", "创建"],
  ["widgets.hermes.googleCalendarUpdate.save", "保存"],
  ["widgets.hermes.inlineResponse.accept", "批准"],
  ["widgets.hermes.inlineResponse.decline", "取消"],
  ["widgets.hermes.permission.connect", "连接"],
  ["widgets.hermes.permission.connected", "已连接"],
  ["widgets.hermes.permission.connectToConnector", "连接到 {connectorName}"],
  ["widgets.hermes.permission.moreInformation", "更多信息"],
  ["widgets.hermes.permission.notNow", "暂不连接"],
  ["widgets.hermes.permission.reconnect", "重新连接"],
  ["widgets.hermes.permission.reconnectToConnector", "重新连接到 {connectorName}"],
  ["widgets.hermes.taskSources.moreSources", "另有 {count} 个来源"],
  ["widgets.hermes.taskSources.showLess", "收起"],
  ["widgets.hermes.taskStatus.canceled", "任务已取消"],
  ["widgets.hermes.taskStatus.canceling", "正在取消"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.checkingPastMessages", "正在检查历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.diggingThroughPastMessages", "正在查找历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.goingThroughPastMessages", "正在浏览历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.lookingOverPastMessages", "正在查看历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.lookingThroughPastMessages", "正在翻阅历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.readingThroughPastMessages", "正在阅读历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.reviewingPastMessages", "正在回顾历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.revisitingPastMessages", "正在重新查看历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.scanningPastMessages", "正在扫描历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.siftingThroughPastMessages", "正在筛查历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialA.sortingThroughPastMessages", "正在梳理历史消息"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.checkingContext", "正在检查上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.goingThroughContext", "正在浏览上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.inspectingContext", "正在核查上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.readingContext", "正在阅读上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.reviewingContext", "正在回顾上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.revisitingContext", "正在重新查看上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.scanningContext", "正在扫描上下文"],
  ["widgets.hermes.waitState.followUpMessagesInitialB.sortingThroughContext", "正在梳理上下文"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.activatingAgent", "正在激活代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.bootingUpAgent", "正在启动代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.bringingAgentOnline", "正在使代理上线"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.callingForthAgent", "正在呼叫代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.connectingToAgent", "正在连接代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.establishingAgentConnection", "正在建立代理连接"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.gettingAgentOutOfBed", "正在唤醒代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.initializingAgent", "正在初始化代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.nudgingAgentAwake", "正在叫醒代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.spinningUpAgent", "正在启动代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialA.summoningAgent", "正在召唤代理"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.activatingComputer", "正在激活计算机"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.bootingUpComputer", "正在启动计算机"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.bringingComputerOnline", "正在使计算机上线"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.initializingComputer", "正在初始化计算机"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.poweringUpComputer", "正在开启计算机"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.spinningUpComputer", "正在启动计算机"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.startingComputer", "正在启动计算机"],
  ["widgets.hermes.waitState.loadingMessagesInitialB.wakingUpComputer", "正在唤醒计算机"],
  ["widgets.hermes.waitState.midLoadingMessagesB.chartingCourse", "正在规划步骤"],
  ["widgets.hermes.waitState.midLoadingMessagesB.layingOutAPlan", "正在拟定计划"],
  ["widgets.hermes.waitState.midLoadingMessagesB.makingAPlan", "正在制定计划"],
  ["widgets.hermes.waitState.midLoadingMessagesB.mappingThingsOut", "正在梳理思路"],
  ["widgets.hermes.waitState.midLoadingMessagesB.mappingThingsOutAgain", "正在梳理思路"],
  ["widgets.hermes.waitState.midLoadingMessagesB.organizingNextMoves", "正在安排下一步操作"],
  ["widgets.hermes.waitState.midLoadingMessagesB.plotting", "正在谋划"],
  ["widgets.hermes.waitState.midLoadingMessagesB.settingDirection", "正在确定方向"],
  ["widgets.hermes.waitState.midLoadingMessagesB.settingDirectionAgain", "正在确定方向"],
  ["widgets.hermes.waitState.midLoadingMessagesB.sketchingGamePlan", "正在拟定行动方案"],
  ["widgets.hermes.waitState.midLoadingMessagesB.thinkingThroughApproaches", "正在考虑可行方法"],
  ["widgets.hermes.waitState.midLoadingMessagesB.workingOutApproach", "正在确定处理方法"],
  ["widgets.hermes.waitState.midLoadingMessagsA.assemblingDetails", "正在整合详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.collectingDetails", "正在收集详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.fillingInDetails", "正在补充详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.gatheringDetails", "正在搜集详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.piecingTogetherDetails", "正在汇总详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.pullingTogetherDetails", "正在整理详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.roundingUpDetails", "正在汇集详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.sortingOutDetails", "正在梳理详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.takingStockOfDetails", "正在盘点详细信息"],
  ["widgets.hermes.waitState.midLoadingMessagsA.trackingDownDetails", "正在查找详细信息"],
  ["widgets.hermes.waitState.outlierMessagesA.takingLongerThanUsual", "此次处理耗时比平时更长"],
  ["widgets.hermes.waitState.outlierMessagesB.closeThisTabAndComeBackLater", "仍在处理中"],
  ["widgets.hermes.waitState.outlierMessagesB.feelFreeToLeaveAndComeBackLater", "你可以稍后再来查看"],
  ["widgets.hermes.workflow.canceled", "任务已取消"],
  ["widgets.hermes.workflow.canceledItemLabel", "已取消"],
  ["widgets.hermes.workflow.codeBlock.hideLines", "收起代码行"],
  ["widgets.hermes.workflow.codeBlock.showAllLines", "查看全部 {lineCount} 行"],
  ["widgets.hermes.workflow.customWorked", "已处理一段时间"],
  ["widgets.hermes.workflow.customWorking", "正在处理"],
  ["widgets.hermes.workflow.fileWorked", "已扫描文档"],
  ["widgets.hermes.workflow.fileWorking", "正在扫描文档"],
  ["widgets.hermes.workflow.group.readingConnector", "正在读取 {connectorName}"],
  ["widgets.hermes.workflow.group.writingConnector", "正在写入 {connectorName}"],
  ["widgets.hermes.workflow.imageWorked", "已分析图片"],
  ["widgets.hermes.workflow.imageWorking", "正在分析图片"],
  ["widgets.hermes.workflow.preparingResponse", "正在准备回复"],
  ["widgets.hermes.workflow.searchWithQuery", "正在搜索：{query}"],
  ["widgets.hermes.workflow.searchWorked", "已搜索网页"],
  ["widgets.hermes.workflow.searchWorking", "正在搜索网页"],
  ["widgets.hermes.workflow.sourcesButton", "来源"],
  ["widgets.hermes.workflow.thoughtWorked", "已思考一段时间"],
  ["widgets.hermes.workflow.thoughtWorking", "正在思考"],
  ["widgets.hermes.workflow.workedForDuration", "已处理 {duration}"],
  ["widgets.listView.showLess", "收起"],
  ["widgets.listView.showMore", "再显示 {count} 项"],
  ["widgets.radioGroup.options", "选项"],
  ["widgets.segmentedControl.selectAnOption", "选择一个选项"],
];

const ZH_CN_TRANSLATIONS = new Map(ZH_CN_TRANSLATION_SPECS);
if (ZH_CN_TRANSLATIONS.size !== ZH_CN_TRANSLATION_SPECS.length) {
  throw new Error("Duplicate zh-CN translation message ID");
}

// Keep this intentionally small. These are confirmed semantic mistakes in the
// current upstream catalog, not merely different wording preferences.
const ZH_CN_FORCED_OVERRIDES = new Map([
  ["composer.placeholder.plan", "描述你的任务以生成计划…"],
  ["composerTips.planMode.action", "创建计划"],
  ["implementPlanRequest.editedPlanError", "无法使用已编辑的计划，请重试"],
  ["localConversation.planSummary.closeSidePanel", "关闭计划侧边栏"],
  ["localConversation.planSummary.download", "下载计划"],
  ["localConversation.planSummary.openInSidePanel", "在侧边栏中打开计划"],
  ["localConversation.planSummary.title", "计划"],
  [
    "settings.general.experimentalFeatures.requestUserInput.description",
    "允许 Codex 在计划模式之外提问。更改仅适用于新对话串",
  ],
  [
    "composer.mode.agentMode.fullAccessConfirm.riskDescriptionByModel",
    "这会带来敏感数据丢失或泄露、提示词注入等风险。{isCyberModel, select, true {我们强烈建议改选“替我批准”，并根据你的使用场景自定义审核者策略。} other {你可以随时关闭此功能。}} <link>了解更多</link>",
  ],
  [
    "codex.commandDescription.composer.togglePlanMode",
    "在当前输入框中开启或关闭规划模式",
  ],
]);

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (node.type) visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child?.type) walk(child, visitor);
      }
    } else if (value?.type) {
      walk(value, visitor);
    }
  }
}

function identifierName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return null;
}

function locateCatalogObject(ast) {
  const defaultLocals = [];
  walk(ast, (node) => {
    if (node.type !== "ExportNamedDeclaration") return;
    for (const specifier of node.specifiers ?? []) {
      if (identifierName(specifier.exported) === "default") {
        defaultLocals.push(identifierName(specifier.local));
      }
    }
  });
  const localNames = [...new Set(defaultLocals.filter(Boolean))];
  if (localNames.length !== 1) {
    throw new Error(
      `Expected one zh-CN default export binding, found ${localNames.length}`,
    );
  }

  const candidates = [];
  walk(ast, (node) => {
    if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left?.type === "Identifier" &&
      node.left.name === localNames[0] &&
      node.right?.type === "ObjectExpression"
    ) {
      candidates.push(node.right);
    }
  });
  if (candidates.length !== 1) {
    throw new Error(
      `Expected one zh-CN catalog object, found ${candidates.length}`,
    );
  }
  return candidates[0];
}

function staticStringValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function templateLiteral(value) {
  return (
    "`" +
    value
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${") +
    "`"
  );
}

function catalogPropertyKey(property) {
  if (property?.type !== "Property" || property.computed) return null;
  return identifierName(property.key);
}

function patchCatalogSource(
  source,
  translations = ZH_CN_TRANSLATIONS,
  overrides =
    translations === ZH_CN_TRANSLATIONS
      ? ZH_CN_FORCED_OVERRIDES
      : new Map(),
) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const catalog = locateCatalogObject(ast);
  const properties = new Map();
  for (const property of catalog.properties) {
    const key = catalogPropertyKey(property);
    if (key == null) continue;
    if (properties.has(key)) {
      throw new Error(`Duplicate zh-CN catalog key: ${key}`);
    }
    properties.set(key, property);
  }

  const patches = [];
  const replacements = [];
  const missing = [];
  for (const [messageId, translation] of translations) {
    const property = properties.get(messageId);
    if (!property) {
      missing.push([messageId, translation]);
      replacements.push({ messageId, translation, status: "added" });
      continue;
    }
    const current = staticStringValue(property.value);
    if (current == null) {
      throw new Error(`zh-CN catalog value is not static: ${messageId}`);
    }
    const override = overrides.get(messageId);
    if (override == null || current === override) continue;
    patches.push({
      start: property.value.start,
      end: property.value.end,
      replacement: templateLiteral(override),
    });
    replacements.push({
      from: current,
      messageId,
      translation: override,
      status: "updated",
    });
  }

  if (missing.length > 0) {
    const entries = missing
      .map(
        ([messageId, translation]) =>
          `${JSON.stringify(messageId)}:${templateLiteral(translation)}`,
      )
      .join(",");
    patches.push({
      start: catalog.end - 1,
      end: catalog.end - 1,
      replacement: `${catalog.properties.length > 0 ? "," : ""}${entries}`,
    });
  }

  patches.sort((left, right) => right.start - left.start);
  let code = source;
  for (const patch of patches) {
    code =
      code.slice(0, patch.start) +
      patch.replacement +
      code.slice(patch.end);
  }
  return { code, replacements };
}

function platformNames(platform) {
  if (platform === "unix") return ["mac-arm64", "mac-x64"];
  if (platform) return [platform];
  return ["mac-arm64", "mac-x64", "win"].filter((name) =>
    fs.existsSync(path.join(SRC_DIR, name, "_asar", "webview", "assets")),
  );
}

function locateTargets(platform) {
  const targets = [];
  for (const name of platformNames(platform)) {
    const assetsDir = path.join(
      SRC_DIR,
      name,
      "_asar",
      "webview",
      "assets",
    );
    if (!fs.existsSync(assetsDir)) {
      if (platform) throw new Error(`Webview assets are missing: ${assetsDir}`);
      continue;
    }
    const matches = fs
      .readdirSync(assetsDir)
      .filter((file) => /^zh-CN-[A-Za-z0-9_-]+\.js$/.test(file));
    if (matches.length !== 1) {
      throw new Error(
        `Expected one zh-CN catalog for ${name}, found ${matches.length}`,
      );
    }
    targets.push({ platform: name, path: path.join(assetsDir, matches[0]) });
  }
  return targets;
}

function main() {
  const args = process.argv.slice(2);
  const platform = args.find((value) =>
    ["mac-arm64", "mac-x64", "win", "unix"].includes(value),
  );
  const isCheck = args.includes("--check");
  const targets = locateTargets(platform);
  if (targets.length === 0) {
    console.log("  [ok] No zh-CN catalogs found");
    return;
  }

  let total = 0;
  for (const target of targets) {
    const source = fs.readFileSync(target.path, "utf8");
    const result = patchCatalogSource(source);
    total += result.replacements.length;
    console.log(`\n-- [${target.platform}] ${relPath(target.path)}`);
    if (result.replacements.length === 0) {
      console.log("   [ok] zh-CN voice messages already complete");
      continue;
    }
    const added = result.replacements.filter(
      (replacement) => replacement.status === "added",
    ).length;
    const updated = result.replacements.length - added;
    console.log(`   * added ${added}, updated ${updated}`);
    if (!isCheck) {
      fs.writeFileSync(target.path, result.code, "utf8");
      console.log("   [ok] zh-CN voice messages localized");
    }
  }
  if (isCheck) {
    console.log(`\n=> Total patchable zh-CN messages: ${total}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[x] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ZH_CN_FORCED_OVERRIDES,
  ZH_CN_TRANSLATIONS,
  ZH_CN_TRANSLATION_SPECS,
  locateTargets,
  patchCatalogSource,
};
