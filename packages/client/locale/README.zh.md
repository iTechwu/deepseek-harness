# @deepseek-ai/dsh-client-locale

[English](README.md) | 中文

locale 插件：LocaleRuntime——`zh`／`en` 偏好以 `locale.preference` 存储在 `$DSH_HOME/settings.yaml` 中；若没有显式 Host 值，全新浏览器会暂时使用 `navigator` 请求的语言（按主子标签匹配；若其请求的语言本应用都不提供，则使用 `en`）。Host 读取在插件激活后执行，因此 settings 服务不可用不会阻塞页面；读取结果会实时替换浏览器暂定值。settings API 仅限回环请求，因此远程浏览器的选择仅保留在进程内。`locale/change` 仅在切换语言时触发；插件会在激活时以及每次切换时把 `<html lang>` 指向当前 locale（`zh-CN`／`en`）。该服务还拥有 ns×locale 字典注册表（类型化 `register(ns, {zh, en})` 按 `LocaleNamespaceMap` 校验，`bind(ns)`→`TranslateNS<ns>`；查找链 ns → common → en → key），实现 slot 系统的 `LocaleFace`，并经 `ctx.slots.installLocale` 自行安装，支撑框架注入的 `t` 标准席位（`Translate`／`TranslateNS` 是 ui-slots 的类型；请从那里导入——本包的再导出仅为字典所有者提供便利）。该持久化边界由[Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.zh.md)拥有。

## 模型体验

### 回复语言 system prompt

#### 模型看到的内容

当显式设置 `locale.preference` 时，Host half 会添加实时的 `preference:response-language` 分节：`zh` 要求模型面向用户的自然语言内容使用中文，`en` 要求使用英文。该指令要求代码、命令、路径、标识符、文件内容和引用文本保持原样；用户明确要求其他语言时，以用户要求为准。偏好缺失时，本包不添加语言指令。

##### Prompt 文本

```markdown
请始终使用中文回答用户。解释、总结、状态更新和其他面向用户的自然语言内容使用中文。代码、命令、路径、标识符、文件内容和引用文本保持原样；除非用户明确要求其他语言，否则不要切换语言。
```

#### Token 影响

仅在存在显式偏好时添加一条简短指令；没有偏好时不增加 prompt token。

#### KV Cache 影响

语言分节会在每次模型请求组装 system prompt 时读取，因此设置变更会对后续请求生效，不需要重启会话。对于同一偏好，文本是确定的；只有偏好变更时才会改变 system-prompt 缓存键。

## 已知限制与暂缓事项

- **部分界面仍保留内联文案**——设置行、侧边栏、问题作答器和模型选择使用 locale seat；其他包仍直接拥有静态文本。
- **注册表持有的文本只读取一次翻译**——在 slot 渲染路径之外于注册时捕获的文案（例如 command 注册表中的 `/model` 命令描述）在重新注册前保持注册时的语言；slot 渲染的文案随切换实时更新。
