# Agent Note: Locale preference guides model response language

Status: implemented

[English](2026-08-25-locale-preference-guides-model-response-language.md) | 中文

## 问题

浏览器语言选择器会改变 UI 文案和 `<html lang>`，但选中的语言没有进入面向模型的 prompt。因此用户选择中文后，仍可能收到其他语言的自然语言回复。

## 决策

`@deepseek-ai/dsh-client-locale` 的 Host half 在已有 `locale` settings namespace 旁注册动态 system-prompt 分节。每次组装 prompt 时读取当前显式的 `locale.preference`：`zh` 要求自然语言回复使用中文，`en` 要求使用英文。该指令要求代码、命令、路径、标识符、文件内容和引用文本保持原样；用户明确要求其他语言时，以用户要求为准。偏好缺失时不添加指令，既有模型行为保持不变。

## 曾考虑的替代方案

**保持 locale 仅作用于 UI。** 这能保留原有包边界，但无法满足选择中文应影响模型输出的用户可见预期。

**增加独立的模型语言设置。** 第二个偏好可能与 UI 显示语言分离，并在没有独立产品需求的情况下增加另一套持久化与配置表面。

**改写用户消息或后处理提供方输出。** 改写会改变用户可见输入，后处理也可能损坏结构化输出；system prompt 是现有的模型扩展点，并能保留原始内容。

## 后果

语言偏好在 prompt 组装时读取，因此无需重启会话即可对后续模型请求生效。没有偏好时不会增加 prompt token。该指令只约束自然语言回复，保证可执行内容和引用材料按原样使用。

## 验证

locale Host 测试先在无偏好时组装 system prompt，再验证实时 settings 更新后的中文和英文指令。locale 包类型检查验证 settings scope 与 system-prompt 的集成。
