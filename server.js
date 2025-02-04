const linebot = require('@line/bot-sdk');
const express = require('express');
const { format, isAfter, addHours } = require('date-fns');

const channelSecret = 'YOUR_CHANNEL_SECRET'; // LINE Developersコンソールで取得したチャネルシークレット
const channelAccessToken = 'YOUR_CHANNEL_ACCESS_TOKEN'; // LINE Developersコンソールで取得したアクセストークン

const config = {
    channelSecret: channelSecret,
    channelAccessToken: channelAccessToken
};

const app = express();
const bot = new linebot.Client(config);

// ユーザーごとの薬を飲む時間とリマインダーの状態を保持するオブジェクト
const userReminders = {};

// Webhookエンドポイント
app.post('/webhook', linebot.middleware(config), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result));
});

// イベントハンドラー
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null); // テキストメッセージ以外は処理しない
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();

    if (messageText === '飲んだ') {
        stopReminder(userId); // リマインダー停止
        return bot.replyMessage(event.replyToken, { type: 'text', text: 'お薬を飲んだんですね！リマインダーを停止します。' });
    } else if (messageText === '時間設定') {
        return bot.replyMessage(event.replyToken, { type: 'text', text: '薬を飲む時間を設定してください。\n例: 21:00' });
    } else if (userReminders[userId] && userReminders[userId].settingTime) {
        // 時間設定モードの場合
        const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/; // 時刻の正規表現 (例: 21:00)
        if (timeRegex.test(messageText)) {
            setUserTime(userId, messageText);
            return bot.replyMessage(event.replyToken, { type: 'text', text: `薬を飲む時間を ${messageText} に設定しました。毎日この時間に通知します。` });
        } else {
            return bot.replyMessage(event.replyToken, { type: 'text', text: '時刻の形式が正しくありません。\n例: 21:00 のように入力してください。' });
        }
    } else {
        return bot.replyMessage(event.replyToken, { type: 'text', text: '「飲んだ」または「時間設定」と入力して操作してください。' });
    }
}

// ユーザーの薬を飲む時間を設定
function setUserTime(userId, time) {
    userReminders[userId] = {
        time: time,
        reminderInterval: null,
        settingTime: false // 時間設定モード解除
    };
    startReminder(userId); // リマインダー開始
}

// リマインダーを開始する関数
function startReminder(userId) {
    if (!userReminders[userId] || userReminders[userId].reminderInterval) {
        return; // すでにリマインダーが設定されている場合は何もしない
    }

    userReminders[userId].reminderInterval = setInterval(() => {
        sendReminderNotification(userId);
    }, 60 * 60 * 1000); // 1時間ごとに通知を送信 (ミリ秒単位)
    userReminders[userId].settingTime = false; // 時間設定モード解除
    sendReminderNotification(userId); // 初回通知をすぐに送信
}

// リマインダーを停止する関数
function stopReminder(userId) {
    if (userReminders[userId] && userReminders[userId].reminderInterval) {
        clearInterval(userReminders[userId].reminderInterval);
        userReminders[userId].reminderInterval = null;
    }
}

// リマインダー通知を送信する関数
function sendReminderNotification(userId) {
    if (!userReminders[userId] || !userReminders[userId].time) {
        return; // 時間が設定されていない場合は通知しない
    }

    const now = new Date();
    const [hours, minutes] = userReminders[userId].time.split(':').map(Number);
    const reminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

    // まだ通知時間になっていない場合は何もしない
    if (isAfter(reminderTime, now)) {
        return;
    }

    // 通知時間を過ぎている場合は通知を送信
    bot.pushMessage(userId, { type: 'text', text: `薬を飲む時間ですよ！飲んだら「飲んだ」と入力してください。` })
        .catch((err) => {
            console.error("Push message error", err);
        });
    // 次の通知時間を1時間後に設定 (1時間ごとのリマインダー)
    userReminders[userId].nextReminderTime = addHours(now, 1);
}


// 時間設定モードを開始する処理
app.post('/webhook', linebot.middleware(config), (req, res) => { // 既存のWebhookエンドポイント内に記述
    Promise.all(req.body.events.map(handleEvent))
        .then((result) => res.json(result));
});

async function handleEvent(event) { // 既存のイベントハンドラー関数内に記述
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const messageText = event.message.text.trim();

    if (messageText === '飲んだ') {
        stopReminder(userId);
        return bot.replyMessage(event.replyToken, { type: 'text', text: 'お薬を飲んだんですね！リマインダーを停止します。' });
    } else if (messageText === '時間設定') {
        userReminders[userId] = userReminders[userId] || {}; // ユーザーデータ初期化
        userReminders[userId].settingTime = true; // 時間設定モードON
        stopReminder(userId); // 既存のリマインダーがあれば停止
        return bot.replyMessage(event.replyToken, { type: 'text', text: '薬を飲む時間を設定してください。\n例: 21:00' });
    }
    // ... (既存のhandleEvent内の処理) ...
}


// ポート設定とサーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`listening on ${port}`);
});