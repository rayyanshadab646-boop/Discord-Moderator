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
// --- CONFIGURE YOUR ROLE IDS HERE ---
// =========================================================================

const ALLOWED_MOD_ROLES = [
    '1568705082235682888', // Junior Mod Role ID
    '1568707527674302494', // Senior Mod Role ID
    '1568723688432607392',
    '1568726228360499220',
    '1568727225681838211', // Admin Role ID
];

// Roles requiring a reason for general actions (like /timeout)
const ROLES_REQUIRING_REASON = [
    '1568726228360499220',
    '1568727225681838211',
];

const ROLES_OPTIONAL_REASON = [
    '1568705082235682888',
    '1568707527674302494',
    '1568723688432607392',
];
// =========================================================================

// Stores strikes: Map<userId, strikeCount>
const userStrikes = new Map();

function getModPermissionCategory(member) {
    const memberRoles = member.roles.cache;

    const isAuthorized = member.permissions.has(PermissionFlagsBits.Administrator) || 
                          ALLOWED_MOD_ROLES.some(roleId => memberRoles.has(roleId));

    if (!isAuthorized) {
        return null; 
    }

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
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    const reasonInput = options.getString('reason');

    if (!targetMember) {
        return interaction.reply({ content: 'User not found in this server.', ephemeral: true });
    }

    const isHighestAdminOrOwner = guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.Administrator);

    // --- HIERARCHY CHECK FOR TARGETING USERS ---
    if (!isHighestAdminOrOwner && targetMember.roles.highest.position >= member.roles.highest.position) {
        return interaction.reply({
            content: '❌ You cannot perform moderation actions on a user with an equal or higher role than yours.',
            ephemeral: true
        });
    }

    // --- RULE: REASON IS MANDATORY FOR STRIKES NO MATTER THE ROLE ---
    if (commandName === 'strike') {
        if (!reasonInput || reasonInput.trim() === '') {
            return interaction.reply({ 
                content: '❌ **Reason Required:** You must provide a reason when issuing a strike.', 
                ephemeral: true 
            });
        }
    }

    // Reason validation for regular timeouts based on role tiers
    if (commandName === 'timeout' && permCategory === 'REQUIRED' && (!reasonInput || reasonInput.trim() === '')) {
        return interaction.reply({ 
            content: '❌ **Reason Required:** Your staff role requires you to specify a reason for timeouts.', 
            ephemeral: true 
        });
    }

    const finalReason = reasonInput && reasonInput.trim() !== '' ? reasonInput : 'No reason provided by moderator.';

    if (commandName === 'strike') {
        const currentStrikes = (userStrikes.get(targetUser.id) || 0) + 1;
        userStrikes.set(targetUser.id, currentStrikes);

        let escalationText = '';

        if (currentStrikes === 2) {
            await targetMember.timeout(10 * 60 * 1000, 'Auto escalation: 2 strikes');
            escalationText = '\n⚠️ **Auto Escalation:** Applied 10-minute timeout for reaching 2 strikes.';
        } else if (currentStrikes === 3) {
            await targetMember.timeout(60 * 60 * 1000, 'Auto escalation: 3 strikes');
            escalationText = '\n🚨 **Auto Escalation:** Applied 1-hour timeout for reaching 3 strikes.';
        } else if (currentStrikes >= 4) {
            await targetMember.timeout(24 * 60 * 60 * 1000, 'Auto escalation: 4+ strikes');
            escalationText = '\n⛔ **Auto Escalation:** Applied 24-hour timeout for reaching 4+ strikes.';
        }

        await targetUser.send({
            content: `You received a strike in **${guild.name}**.\n**Reason:** ${finalReason}\n**Total Strikes:** ${currentStrikes}`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('Strike Issued')
            .setColor(0xFF9900)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Moderator', value: `${member.user.tag}`, inline: true },
                { name: 'Total Strikes', value: `${currentStrikes}`, inline: true },
                { name: 'Reason', value: finalReason }
            )
            .setTimestamp();

        return interaction.reply({ content: escalationText, embeds: [embed] });
    }

    if (commandName === 'removestrike') {
        const currentStrikes = userStrikes.get(targetUser.id) || 0;

        if (currentStrikes <= 0) {
            return interaction.reply({ content: `❌ **${targetUser.tag}** has 0 strikes to remove.`, ephemeral: true });
        }

        // --- RULE: ONLY SOMEONE WITH A HIGHER ROLE CAN REMOVE IT ---
        // Check if the strike issuer/target had a higher role, meaning this staff member is strictly higher than them.
        if (!isHighestAdminOrOwner && targetMember.roles.highest.position >= member.roles.highest.position) {
            return interaction.reply({
                content: '❌ You must have a higher role than the user to remove their strike.',
                ephemeral: true
            });
        }

        const newStrikes = currentStrikes - 1;
        userStrikes.set(targetUser.id, newStrikes);

        const embed = new EmbedBuilder()
            .setTitle('Strike Removed')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Moderator', value: `${member.user.tag}`, inline: true },
                { name: 'Remaining Strikes', value: `${newStrikes}`, inline: true }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'timeout') {
        const durationMinutes = options.getInteger('duration');

        if (durationMinutes <= 0 || durationMinutes > 40320) {
            return interaction.reply({ content: 'Duration must be between 1 and 40,320 minutes (28 days).', ephemeral: true });
        }

        const durationMs = durationMinutes * 60 * 1000;
        await targetMember.timeout(durationMs, `${finalReason} (By ${member.user.tag})`);

        await targetUser.send({
            content: `You have been timed out in **${guild.name}** for **${durationMinutes} minute(s)**.\n**Reason:** ${finalReason}`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('User Timed Out')
            .setColor(0xCC0000)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Duration', value: `${durationMinutes} min`, inline: true },
                { name: 'Moderator', value: `${member.user.tag}`, inline: true },
                { name: 'Reason', value: finalReason }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'untime') {
        await targetMember.timeout(null, `Timeout removed by ${member.user.tag}`);

        await targetUser.send({
            content: `Your timeout has been removed in **${guild.name}** by staff.`
        }).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('Timeout Removed')
            .setColor(0x00CC00)
            .addFields(
                { name: 'Target User', value: `${targetUser.tag} (\`${targetUser.id}\`)`, inline: true },
                { name: 'Moderator', value: `${member.user.tag}`, inline: true }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'warnings') {
        const count = userStrikes.get(targetUser.id) || 0;
        return interaction.reply({
            content: `**${targetUser.tag}** currently has **${count}** strike(s).`,
            ephemeral: true
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
