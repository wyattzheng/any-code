# Proto 类型结构

## 概述

Go binary 的 proto 类型来自 `google3/third_party/jetski/` 的多个包。以下通过 Go binary 的反射元数据（struct tags）逆向得出。

## 核心类型

### SendUserCascadeMessageRequest

包: `language_server_go_proto`

| Field | Type | Proto |
|-------|------|-------|
| cascade_id | string | field 1 |
| items | repeated CascadeInputItem | field 2 |
| metadata | ManagementMetadata | field 3 |
| cascade_config | CascadeConfig | field 5 |

### CascadeConfig

包: `cortex_go_proto`

| Field | Type |
|-------|------|
| planner_config | CascadePlannerConfig |
| checkpoint_config | CheckpointConfig |
| executor_config | ... |
| message_config | ... |
| conversation_history_config | ... |
| trajectory_conversion_config | ... |
| apply_model_default_override | ... |
| split_dynamic_prompt_sections | ... |

### CascadePlannerConfig

包: `cortex_go_proto`

| Field | Type | Proto | 说明 |
|-------|------|-------|------|
| plan_model | Model enum | varint, field 1 | 模型 ID（如 1026） |
| requested_model | RequestedModel | field 12(?) | 指定模型 |
| model_name | string | | 模型名称 |
| max_output_tokens | int32 | varint, field 11 | 最大输出 token |
| conversational | CascadeConversationalPlannerConfig | | 对话模式配置 |
| custom_agent | CustomAgentSpec | | 自定义 Agent |
| custom_agent_config_absolute_uri | string | | Agent 配置文件路径 |
| customization_config | CustomizationConfig | | 定制配置 |
| prompt_section_customization_config | PromptSectionCustomizationConfig | | **系统提示词定制** |
| tool_config | ToolConfig | | 工具配置 |
| agentic_mode_config | ... | | |
| knowledge_config | ... | | |
| retry_config | ... | | |
| truncation_threshold_tokens | int32 | | |
| planner_type_config | oneof | | |
| no_tool_explanation | bool | | |
| no_tool_summary | bool | | |
| no_wait_for_previous_tools | bool | | |
| show_all_errors | bool | | |
| ephemeral_messages_config | ... | | |
| step_string_converter_config | ... | | |

### PromptSectionCustomizationConfig

| Field | Type | 说明 |
|-------|------|------|
| add_prompt_sections | repeated CustomPromptSection | 添加（带位置控制） |
| append_prompt_sections | repeated PromptSection | **追加（最简单）** |
| remove_prompt_sections | repeated string(?) | 删除 |
| replace_prompt_sections | repeated CustomPromptSection(?) | 替换 |

### PromptSection

| Field | Type | 说明 |
|-------|------|------|
| title | string | 段落标题 |
| content | string | 段落内容 |
| dynamic_content | ... | 动态内容 |
| criteria | ... | 条件 |
| token_source | ... | |
| token_type | ... | |
| metadata | PromptSectionMetadata | |

### CustomPromptSection

| Field | Type | 说明 |
|-------|------|------|
| prompt_section | PromptSection | 段落 |
| placement | ... | 放置策略 |
| insert_before_section | string | 在此段落前插入 |
| insert_after_section | string | 在此段落后插入 |

### CustomAgentSpec

| Field | Type | 说明 |
|-------|------|------|
| cascade_config | CascadeConfig | 嵌套 CascadeConfig |
| custom_tools | repeated ... | 自定义工具 |
| mcp_servers | repeated ... | MCP 服务器 |
| skills | repeated ... | Skills |
| workspace | ... | 工作区 |
| workspace_paths | repeated ... | 工作区路径 |
| prompt_section_customization | ... | 提示词定制 |
| enforced_workspace_validation | bool | |
| skip_mcp_prefixes | ... | |

### CustomAgentSystemPromptConfig

| Field | Type | 说明 |
|-------|------|------|
| include_workspace_prompt | bool | 包含工作区提示词 |
| include_mcp_server_prompt | bool | 包含 MCP 提示词 |
| include_artifact_instructions | bool | 包含 Artifact 指令 |
| include_skills_prompt | bool | 包含 Skills 提示词 |

### ManagementMetadata

包: `index_go_proto`

| Field | Type | Proto |
|-------|------|-------|
| api_key | string | bytes, field 1 |

写入 Go binary stdin 用于启动。

## 模型枚举

`exa.codeium_common_pb.Model` 枚举，Go binary 含 `MODEL_PLACEHOLDER_M0` ~ `MODEL_PLACEHOLDER_M114`。

数值映射：`planModel = 1000 + N`，其中 N 为 `MODEL_PLACEHOLDER_M<N>` 的后缀。

已验证：
- 1026 → M26 ✅
- 1008 → M8 ❌ (deprecated)
- 1009-1012 → M9-M12 ❌ (not found)
