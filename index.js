const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const express = require('express');
require('dotenv').config();

// --- UPTIME ROBOT / RENDER KEEP-ALIVE WEB SERVER ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('Bot is online and running!');
});

app.get('/ping', (req, res) => {
    res.status(200).send('PONG');
});

app.listen(PORT, () => {
    console.log(`Keep-alive server listening on port ${PORT}`);
});
// --------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// =========================================================================
// --- CONFIGURE YOUR ROLES & AUDIT CHANNEL ID HERE ---
// =========================================================================

const AUDIT_LOG_CHANNEL_ID = 'YOUR_MOD_LOGS_CHANNEL_ID_HERE'; // <-- Paste your channel ID here!

const ALLOWED_MOD_ROLES = [
    '1568705082235682888', // Junior Mod Role ID
    '1568707527674302494', // Senior Mod Role ID
    '1568723688432607392',
    '1568726228360499220',
    '1568727225681838211',
    '1568886123999006751', // Admin Role ID
];

const ROLES_REQUIRING_REASON = [
    '1568726228360499220',
    '1568727225681838211',
];

const ROLES_OPTIONAL_REASON = [
    '1568705082235682888',
    '1568707527674302494',
    '1568723688432607392',
    '1568886123999006751',
];
// =========================================================================

// Enhanced storage tracking issuer details, reasons, and exact timestamps
const userStrikes = new Map();
const activeTimeouts = new Map();

async function sendAuditLog(guild, embed) {
    if (!AUDIT_LOG_CHANNEL_ID || AUDIT_LOG_CHANNEL_ID === 'YOUR_MOD_LOGS_CHANNEL_ID_HERE') return;
    try {
        const channel = await guild.channels.fetch(AUDIT_LOG_CHANNEL_ID).catch(() => null);
        if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error('Failed to send audit log:', err);
    }
}

function getModPermissionCategory(member) {
    const memberRoles = member.roles.cache;
    const isAuthorized = member.permissions.has(PermissionFlagsBits.Administrator) || 
                          ALLOWED_MOD_ROLES.some(roleId => memberRoles.has(roleId));

    if (!isAuthorized) return null; 

    if (ROLES_REQUIRING_REASON.some(roleId => memberRoles.has(roleId)) && 
        !ROLES_OPTIONAL_REASON.some(roleId => memberRoles.has(roleId)) &&
        !member.permissions.has(PermissionFlagsBits.Administrator)) {
        return 'REQUIRED';
    }

    return 'OPTIONAL';
}

client.once('ready', () => {
    console.log(`Bot operational as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, member, guild } = interaction;
    const permCategory = getModPermissionCategory(member);

    if (!permCategory) {
        return interaction.reply({ 
            content: '❌ You do not have the required role to use moderation commands.', 
            ephemeral: true 
        });
    }

    const targetUser = options.getUser('target');
    const targetMember = targetUser ? await guild.members.fetch(targetUser.id).catch(() => null) : null;
    const reasonInput = options.getString('reason');

    const requiresTarget = ['strike', 'removestrike', 'timeout', 'untime', 'warnings', 'strikeinfo', 'timeoutinfo'];
    if (requiresTarget.includes(commandName) && !targetMember) {
        return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    }

    const isHighestAdminOrOwner = guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.Administrator);

    if (requiresTarget.includes(commandName) && commandName !== 'warnings' && commandName !== 'strikeinfo' && commandName !== 'timeoutinfo') {
        if (!isHighestAdminOrOwner && targetMember.roles.highest.position >= member.roles.highest.position) {
            return interaction.reply({
                content: '❌ You cannot target a user who has an equal or higher role than yours.',
                ephemeral: true
            });
        }
    }

    const finalReason = reasonInput && reasonInput.trim() !== '' ? reasonInput : 'No reason provided by moderator.';

    // =========================================================================
    // COMMAND: STRIKE
    // =========================================================================
    if (commandName === 'strike') {
        if (!reasonInput || reasonInput.trim() === '') {
            return interaction.reply({ 
                content: '❌ **Reason Required:** You must provide a reason when issuing a strike.', 
                ephemeral: true 
            });
        }

        const strikes = userStrikes.get(targetUser.id) || [];
        const strikeRecord = {
            issuerId: member.id,
            issuerTag: member.user.tag,
            issuerRolePosition: member.roles.highest.position,
            reason: finalReason,
            timestamp: Date.now()
        };
        strikes.push(strikeRecord);
        userStrikes.set(targetUser.id, strikes);

        const currentStrikes = strikes.length;
        let escalationText = '';

        if (currentStrikes === 2) {
            await targetMember.timeout(10 * 60 * 1000, 'Auto escalation: 2 strikes');
            activeTimeouts.set(targetUser.id, {
                issuerId: client.user.id,
                issuerTag: 'System (Auto-Escalation)',
                issuerRolePosition: 9999,
                reason: 'Auto escalation for reaching 2 strikes',
                timestamp: Date.now(),
                durationMinutes: 10
            });
            escalationText = '\n⚠️ **Auto Escalation:** Applied 10-minute timeout for reaching 2 strikes.';
        } else if (currentStrikes === 3) {
            await targetMember.timeout(60 * 60 * 1000, 'Auto escalation: 3 strikes');
            activeTimeouts.set(targetUser.id, {
                issuerId: client.user.id,
                issuerTag: 'System (Auto-Escalation)',
                issuerRolePosition: 9999,
                reason: 'Auto escalation for reaching 3 strikes',
                timestamp: Date.now(),
                durationMinutes: 60
            });
            escalationText = '\n🚨 **Auto Escalation:** Applied 1-hour timeout for reaching 3 strikes.';
        } else if (currentStrikes >= 4) {
            await targetMember.timeout(24 * 60 * 60 * 1000, 'Auto escalation: 4+ strikes');
            activeTimeouts.set(targetUser.id, {
                issuerId: client.user.id,
                issuerTag: 'System (Auto-Escalation)',
                issuerRolePosition: 9999,
                reason: 'Auto escalation for reaching 4+ strikes',
                timestamp: Date.now(),
                durationMinutes: 1440
            });
            escalationText = '\n⛔ **Auto Escalation:** Applied 24-hour timeout for reaching 4+ strikes.';
        }

        await targetUser.send({
            content: `You received a strike in **${guild.name}**.\n**Reason:** ${finalReason}\n**Total Strikes:** ${currentStrikes}`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Audit Log: Strike Issued')
            .setColor(0xFF9900)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Executor (Mod)', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: 'Total Strikes', value: `${currentStrikes}`, inline: true },
                { name: 'Reason', value: finalReason },
                { name: 'Timestamp', value: `<t:${Math.floor(strikeRecord.timestamp / 1000)}:F>` }
            )
            .setTimestamp();

        await sendAuditLog(guild, embed);
        return interaction.reply({ content: `✅ Strike successfully issued.${escalationText}`, ephemeral: true });
    }

    // =========================================================================
    // COMMAND: REMOVESTRIKE
    // =========================================================================
    if (commandName === 'removestrike') {
        const strikes = userStrikes.get(targetUser.id) || [];

        if (strikes.length === 0) {
            return interaction.reply({ content: `❌ **${targetUser.tag}** has 0 strikes to remove.`, ephemeral: true });
        }

        const lastStrike = strikes[strikes.length - 1];

        if (!isHighestAdminOrOwner && member.id !== lastStrike.issuerId) {
            if (member.roles.highest.position <= lastStrike.issuerRolePosition) {
                return interaction.reply({
                    content: '❌ You cannot remove this strike. You must have a higher role than the staff member who issued it.',
                    ephemeral: true
                });
            }
        }

        strikes.pop();
        userStrikes.set(targetUser.id, strikes);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Audit Log: Strike Removed')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Executor (Mod)', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: 'Original Issuer', value: `${lastStrike.issuerTag}`, inline: true },
                { name: 'Remaining Strikes', value: `${strikes.length}`, inline: true },
                { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
            )
            .setTimestamp();

        await sendAuditLog(guild, embed);
        return interaction.reply({ content: `✅ Strike successfully removed.`, ephemeral: true });
    }

    // =========================================================================
    // COMMAND: TIMEOUT
    // =========================================================================
    if (commandName === 'timeout') {
        const durationMinutes = options.getInteger('duration');

        if (durationMinutes <= 0 || durationMinutes > 40320) {
            return interaction.reply({ content: 'Duration must be between 1 and 40,320 minutes (28 days).', ephemeral: true });
        }

        if (permCategory === 'REQUIRED' && (!reasonInput || reasonInput.trim() === '')) {
            return interaction.reply({ 
                content: '❌ **Reason Required:** Your staff role requires you to specify a reason for timeouts.', 
                ephemeral: true 
            });
        }

        const durationMs = durationMinutes * 60 * 1000;
        await targetMember.timeout(durationMs, `${finalReason} (By ${member.user.tag})`);

        activeTimeouts.set(targetUser.id, {
            issuerId: member.id,
            issuerTag: member.user.tag,
            issuerRolePosition: member.roles.highest.position,
            reason: finalReason,
            timestamp: Date.now(),
            durationMinutes: durationMinutes
        });

        await targetUser.send({
            content: `You have been timed out in **${guild.name}** for **${durationMinutes} minute(s)**.\n**Reason:** ${finalReason}`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Audit Log: User Timed Out')
            .setColor(0xCC0000)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Executor (Mod)', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: 'Duration', value: `${durationMinutes} min`, inline: true },
                { name: 'Reason', value: finalReason },
                { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
            )
            .setTimestamp();

        await sendAuditLog(guild, embed);
        return interaction.reply({ content: `✅ User successfully timed out.`, ephemeral: true });
    }

    // =========================================================================
    // COMMAND: UNTIME
    // =========================================================================
    if (commandName === 'untime') {
        if (!targetMember.isCommunicationDisabled()) {
            return interaction.reply({ content: `❌ **${targetUser.tag}** is not currently timed out.`, ephemeral: true });
        }

        const timeoutInfo = activeTimeouts.get(targetUser.id);

        if (timeoutInfo && !isHighestAdminOrOwner && member.id !== timeoutInfo.issuerId) {
            if (member.roles.highest.position <= timeoutInfo.issuerRolePosition) {
                return interaction.reply({
                    content: '❌ You cannot remove this timeout. You must have a higher role than the staff member who timed them out.',
                    ephemeral: true
                });
            }
        }

        await targetMember.timeout(null, `Timeout removed by ${member.user.tag}`);
        activeTimeouts.delete(targetUser.id);

        await targetUser.send({
            content: `Your timeout has been removed in **${guild.name}** by staff.`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Audit Log: Timeout Removed')
            .setColor(0x00CC00)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Executor (Mod)', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: 'Original Issuer', value: `${timeoutInfo ? timeoutInfo.issuerTag : 'Unknown'}`, inline: true },
                { name: 'Timestamp', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
            )
            .setTimestamp();

        await sendAuditLog(guild, embed);
        return interaction.reply({ content: `✅ Timeout successfully removed.`, ephemeral: true });
    }

    // =========================================================================
    // COMMAND: WARNINGS
    // =========================================================================
    if (commandName === 'warnings') {
        const strikes = userStrikes.get(targetUser.id) || [];
        return interaction.reply({
            content: `**${targetUser.tag}** currently has **${strikes.length}** strike(s).`,
            ephemeral: true
        });
    }

    // =========================================================================
    // COMMAND: STRIKEINFO
    // =========================================================================
    if (commandName === 'strikeinfo') {
        const strikes = userStrikes.get(targetUser.id) || [];

        if (strikes.length === 0) {
            return interaction.reply({ content: `ℹ️ **${targetUser.tag}** has no recorded strikes.`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 Strike History for ${targetUser.tag}`)
            .setColor(0xFF9900)
            .setTimestamp();

        strikes.forEach((strike, index) => {
            embed.addFields({
                name: `Strike #${index + 1}`,
                value: `**Issued By:** ${strike.issuerTag}\n**Reason:** ${strike.reason}\n**Time:** <t:${Math.floor(strike.timestamp / 1000)}:F>`
            });
        });

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // =========================================================================
    // COMMAND: TIMEOUTINFO
    // =========================================================================
    if (commandName === 'timeoutinfo') {
        const timeoutInfo = activeTimeouts.get(targetUser.id);

        if (!targetMember.isCommunicationDisabled() || !timeoutInfo) {
            return interaction.reply({ content: `ℹ️ **${targetUser.tag}** does not have an active tracked timeout.`, ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 Active Timeout Info for ${targetUser.tag}`)
            .setColor(0xCC0000)
            .addFields(
                { name: 'Issued By (Executor)', value: `${timeoutInfo.issuerTag}`, inline: true },
                { name: 'Duration Assigned', value: `${timeoutInfo.durationMinutes} minutes`, inline: true },
                { name: 'Reason', value: timeoutInfo.reason },
                { name: 'Issued At', value: `<t:${Math.floor(timeoutInfo.timestamp / 1000)}:F>` }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
