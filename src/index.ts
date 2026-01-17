// src/index.ts
import { Context, Schema } from 'koishi'
import type { Config as ConfigType, BotConfig } from './types'
import { createConfig as createConfigSchema, name } from './config'
import { BotManager } from './bot-manager'
import { Status } from '@satorijs/protocol'

export { BotConfig } from './types'
export { name } from './config'

// 导出默认静态 Schema
// 在插件加载后，Schema 会在运行时更新为包含指令列表的动态版本
export const Config = Schema.intersect([
    Schema.object({
        bots: Schema.array(Schema.any())
            .role('table')
            .default([])
            .description('Bot 配置列表（插件加载后将显示可用指令）'),
    }).description('基础配置'),
    Schema.object({
        debug: Schema.boolean()
            .default(false)
            .description('启用调试日志'),
    }).description('调试选项'),
]) as Schema<ConfigType>

export function apply(ctx: Context, config: ConfigType) {
    const logger = ctx.logger('multi-bot-controller')

    // 确保 bots 数组存在
    const bots = config.bots || []

    // 创建 Bot 管理服务
    const manager = new BotManager(ctx, bots)

    // 更新 Config Schema 为包含指令列表的动态版本
    // 这样配置界面就能显示可用的指令选项
    const dynamicConfig = createConfigSchema(ctx)
    ;(Config as any).into = (config: any) => {
        // 保持配置不变，只是更新 Schema 的定义
        return config
    }
    Object.assign(Config, dynamicConfig)

    logger.info('Multi-Bot Controller 插件已加载')
    logger.info(`当前配置了 ${bots.length} 个 bot`)

    // 输出可用指令信息（方便用户配置）
    const availableCommands = manager.getAvailableCommands()
    if (availableCommands.length > 0) {
        logger.info(`检测到 ${availableCommands.length} 个可用指令，可在配置中选择`)
    }

    // ========================================
    // 核心功能：在 attach-channel 事件中拦截
    // ========================================
    ctx.on('attach-channel', (session) => {
        // 私聊消息不需要处理 assignee
        if (session.isDirect) return

        const { platform, selfId, channel } = session

        // 获取当前 bot 的配置
        const botConfig = manager.getBotConfig(platform, selfId)

        if (!botConfig) {
            // 没有配置，不干预
            return
        }

        // 判断是否应该响应
        if (!manager.shouldBotRespond(session, botConfig)) {
            // 不应该响应
            // 如果当前 assignee 是自己，主动放弃
            if ((channel as any).assignee === selfId) {
                logger.debug(`[${platform}:${selfId}] 放弃处理消息`)
                ;(channel as any).assignee = ''
            }
            return
        }

        // 应该响应，确保 assignee 是自己
        if ((channel as any).assignee !== selfId) {
            logger.debug(`[${platform}:${selfId}] 接管消息处理`)
            ;(channel as any).assignee = selfId
            // observe 机制会在消息处理结束后自动同步到数据库
        }
    })

    // ========================================
    // 辅助命令
    // ========================================

    // 查看可用的 bots
    ctx.command('mc.bots', '查看可用的 Bot 列表')
        .alias('mbc.bots')
        .action(() => {
            const bots = manager.getAvailableBots()
            if (bots.length === 0) {
                return '当前没有可用的 Bot'
            }

            let output = `可用的 Bot 列表（共 ${bots.length} 个）：\n`
            for (const bot of bots) {
                const statusIcon = bot.status === Status.ONLINE ? '🟢' : '🔴'
                output += `${statusIcon} ${bot.platform}:${bot.selfId}\n`
            }
            return output
        })

    // 查看可用的指令
    ctx.command('mc.commands', '查看可用的指令列表')
        .alias('mbc.commands')
        .action(() => {
            const commands = manager.getAvailableCommands()
            if (commands.length === 0) {
                return '当前没有可用的指令'
            }

            let output = `可用的指令（共 ${commands.length} 个）：\n`
            for (const cmd of commands) {
                output += `- \`${cmd.name}\`${cmd.description ? `: ${cmd.description}` : ''}\n`
            }
            output += '\n提示：在配置界面中选择指令时，可以直接从列表中选择'
            return output
        })

    // 查看当前配置
    ctx.command('mc.config', '查看当前插件配置')
        .alias('mbc.config')
        .action(() => {
            const bots = config.bots || []
            if (bots.length === 0) {
                return '当前没有配置任何 Bot\n\n提示：在插件配置页面点击「添加配置」来新增 Bot 控制规则'
            }

            let output = `当前配置（共 ${bots.length} 个 Bot）：\n\n`

            for (const bot of bots) {
                output += `## ${bot.platform}:${bot.selfId}\n`
                output += `- 启用状态: ${bot.enabled ? '已启用' : '已禁用'}\n`
                output += `- 响应模式: ${bot.mode === 'constrained' ? '约束模式' : '放行模式'}\n`
                output += `- 指令过滤: ${bot.enableCommandFilter ? '已启用' : '未启用（所有指令放行）'}\n`
                if (bot.enableCommandFilter) {
                    output += `  - 指令列表: ${bot.commands.length === 0 ? '（全部允许）' : bot.commands.map(c => `\`${c}\``).join(', ')}\n`
                    output += `  - 过滤模式: ${bot.commandFilterMode === 'blacklist' ? '黑名单' : '白名单'}\n`
                }

                if (bot.mode === 'constrained') {
                    output += `- 关键词: ${bot.keywords.length === 0 ? '（无）' : bot.keywords.map(k => `\`${k}\``).join(', ')}\n`
                    output += `- 关键词过滤: ${bot.keywordFilterMode === 'blacklist' ? '黑名单' : '白名单'}\n`
                }

                output += '\n'
            }

            return output.trim()
        })

    // 快捷添加所有指令到剪贴板（返回文本供用户复制）
    ctx.command('mc.copy-commands', '获取所有指令名称（方便配置时使用）')
        .alias('mbc.copy-commands')
        .action(() => {
            const commands = manager.getAvailableCommands()
            if (commands.length === 0) {
                return '当前没有可用的指令'
            }

            const commandNames = commands.map(c => c.name).join(', ')
            return `所有指令名称（可直接复制到配置中）：\n\n${commandNames}`
        })

    // ========================================
    // 生命周期事件
    // ========================================

    // 当新 bot 上线时
    ctx.on('login-added', ({ platform, selfId }) => {
        logger.info(`新 Bot 上线: ${platform}:${selfId}`)
        // 可以在这里自动添加配置提示
        const existing = manager.getBotConfig(platform, selfId)
        if (!existing) {
            logger.warn(`Bot ${platform}:${selfId} 尚未配置，请添加配置以启用控制`)
        }
    })

    // 插件就绪时
    ctx.on('ready', () => {
        logger.info('Multi-Bot Controller 已就绪')
        const bots = manager.getAvailableBots()
        logger.info(`检测到 ${bots.length} 个 Bot`)

        const onlineBots = bots.filter(b => b.status === Status.ONLINE)
        logger.info(`其中 ${onlineBots.length} 个在线`)

        // 显示配置状态
        const configuredBots = bots.filter(b => manager.getBotConfig(b.platform, b.selfId))
        if (configuredBots.length < bots.length) {
            logger.info(`${bots.length - configuredBots.length} 个 Bot 尚未配置控制规则`)
        }
    })
}
