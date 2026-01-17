// src/config.ts
import { Schema, Context } from 'koishi'
import { BotConfig } from './types'

// 定义独立的配置接口以避免冲突
interface PluginConfig {
    bots: BotConfig[]
    debug: boolean
}

/**
 * 获取所有可用的指令
 */
function getAvailableCommands(ctx: Context) {
    const commandMap = (ctx.$commander as any)?._commandMap
    if (!commandMap) return []

    return Array.from(commandMap.values())
        .filter((cmd: any) => cmd.name && cmd.name !== '' && !cmd.name.includes('.'))
        .map((cmd: any) => ({
            name: cmd.name,
            description: cmd.description || '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 创建指令选择 Schema
 */
const createCommandSelectSchema = (ctx: Context) => {
    const commands = getAvailableCommands(ctx)
    const commandList = commands.map(c => c.name)

    return Schema.array(Schema.union([
        Schema.string(),
        ...commandList.map(name => Schema.const(name)),
    ]))
        .role('table')
        .default([])
        .description(`允许响应的指令列表

可用指令：${commandList.length > 0 ? commandList.join(', ') : '（插件加载时可检测到指令）'}`)
}

/**
 * 创建单个 Bot 配置 Schema
 */
export const createBotConfigSchema = (ctx: Context): Schema<BotConfig> => {
    const commandSelectSchema = createCommandSelectSchema(ctx)
    const commands = getAvailableCommands(ctx)
    const commandList = commands.map(c => c.name)

    return Schema.intersect([
        // === 1. Bot 标识信息 ===
        Schema.object({
            platform: Schema.string()
                .description('平台名称（如 onebot, qq, discord）')
                .required(),
            selfId: Schema.string()
                .description('Bot 账号 ID')
                .required(),
            enabled: Schema.boolean()
                .default(true)
                .description('是否启用此 bot 的响应控制'),
        }).description('Bot 标识'),

        // === 2. 响应模式配置 ===
        Schema.object({
            mode: Schema.union([
                Schema.const('constrained' as const)
                    .description('[约束模式] 非指令消息必须匹配关键词才响应，适合功能型 Bot'),
                Schema.const('unconstrained' as const)
                    .description('[放行模式] 非指令消息全部放行，适合 LLM 智能对话 Bot'),
            ]).default('unconstrained')
                .description('响应模式'),
        }).description('响应模式'),

        // === 3. 指令过滤配置（可选） ===
        Schema.object({
            enableCommandFilter: Schema.boolean()
                .default(false)
                .description('是否启用指令过滤（启用后需要配置指令列表）'),
            commands: commandSelectSchema,
            commandFilterMode: Schema.union([
                Schema.const('blacklist' as const)
                    .description('黑名单：只响应列表中的指令'),
                Schema.const('whitelist' as const)
                    .description('白名单：响应列表外的指令'),
            ]).default('blacklist')
                .description('指令过滤模式'),
        }).description('指令配置（可选，不启用则所有指令都放行）'),

        // === 4. 关键词配置（约束模式专用） ===
        Schema.object({
            keywords: Schema.array(Schema.string())
                .role('table')
                .default([])
                .description('关键词列表（仅约束模式生效）'),
            keywordFilterMode: Schema.union([
                Schema.const('blacklist' as const)
                    .description('黑名单：只响应匹配关键词的消息'),
                Schema.const('whitelist' as const)
                    .description('白名单：只响应不匹配关键词的消息'),
            ]).default('blacklist')
                .description('关键词过滤模式'),
        }).description('关键词配置（仅约束模式需要配置）'),
    ]) as Schema<BotConfig>
}

/**
 * 创建插件配置 Schema
 */
export const createConfig = (ctx: Context): Schema<PluginConfig> => {
    const commands = getAvailableCommands(ctx)
    const commandList = commands.map(c => c.name)

    return Schema.intersect([
        Schema.object({
            bots: Schema.array(createBotConfigSchema(ctx))
                .role('table')
                .default([])
                .description(`Bot 配置列表

检测到 ${commandList.length} 个可用指令：${commandList.slice(0, 20).join(', ')}${commandList.length > 20 ? '...' : ''}

使用 mc.commands 命令查看完整指令列表`),
        }).description('Bot 配置'),
        Schema.object({
            debug: Schema.boolean()
                .default(false)
                .description('启用调试日志（输出详细的决策过程）'),
        }).description('调试选项'),
    ]) as Schema<PluginConfig>
}

// 静态导出（用于类型检查）
export const name = 'multi-bot-controller'

/**
 * 默认静态 Schema（用于初始加载）
 */
export const Config = Schema.intersect([
    Schema.object({
        bots: Schema.array(Schema.intersect([
            Schema.object({
                platform: Schema.string().required().description('平台名称（如 onebot, qq, discord）'),
                selfId: Schema.string().required().description('Bot 账号 ID'),
                enabled: Schema.boolean().default(true).description('是否启用此 bot 的响应控制'),
            }).description('Bot 标识'),
            Schema.object({
                mode: Schema.union([
                    Schema.const('constrained' as const).description('[约束模式] 非指令消息必须匹配关键词才响应'),
                    Schema.const('unconstrained' as const).description('[放行模式] 非指令消息全部放行'),
                ]).default('unconstrained').description('响应模式'),
            }).description('响应模式'),
            Schema.object({
                enableCommandFilter: Schema.boolean().default(false).description('是否启用指令过滤'),
                commands: Schema.array(Schema.string()).role('table').default([]).description('允许响应的指令列表'),
                commandFilterMode: Schema.union([
                    Schema.const('blacklist' as const).description('黑名单'),
                    Schema.const('whitelist' as const).description('白名单'),
                ]).default('blacklist').description('指令过滤模式'),
            }).description('指令配置（可选）'),
            Schema.object({
                keywords: Schema.array(Schema.string()).role('table').default([]).description('关键词列表'),
                keywordFilterMode: Schema.union([
                    Schema.const('blacklist' as const).description('黑名单'),
                    Schema.const('whitelist' as const).description('白名单'),
                ]).default('blacklist').description('关键词过滤模式'),
            }).description('关键词配置（约束模式专用）'),
        ]))
            .role('table')
            .default([])
            .description('Bot 配置列表'),
    }).description('Bot 配置'),
    Schema.object({
        debug: Schema.boolean()
            .default(false)
            .description('启用调试日志'),
    }).description('调试选项'),
]) as Schema<PluginConfig>
