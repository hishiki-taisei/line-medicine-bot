const express = require('express');
const { Client } = require('@line/bot-sdk');
const cron = require('node-cron');

const app = express();

// 環境変数から設定を読み込む (または直接記述)
const channelSecret = process.env.LINE_CHANNEL_SECRET;
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const richMenuId = process.env.LINE_RICH_MENU_ID; // リッチメニューIDを設定

if (!channelSecret) {
    console.error('LINE_CHANNEL_SECRETが設定されていません');
    process.exit(1);
}

if (!channelAccessToken) {
    console.error('LINE_CHANNEL_ACCESS_TOKENが設定されていません');
    process.exit(1);
}
if (!richMenuId) {
    console.error('LINE_RICH_MENU_IDが設定されていません');
    process.exit(1);
}


const client = new Client({
    channelAccessToken: channelAccessToken,
    channelSecret: channelSecret
});

// ユーザーごとの状態を管理するオブジェクト (簡易版: メモリ上)
const userSchedules = {};
// 例: userSchedules[userId] = { scheduledTime: '9:00', cronJob: null, notified: false };

// 薬を飲む時間を設定する関数 (例: メッセージで時間を設定できるようにする)
function setMedicineTime(userId, time) {
    userSchedules[userId] = { scheduledTime: time, cronJob: null, notified: false };
    startNotificationSchedule(userId);
}

// 通知スケジュールを開始する関数
function startNotificationSchedule(userId) {
    if (!userSchedules[userId]) return; // ユーザーのスケジュールが存在しない場合は何もしない

    const scheduledTime = userSchedules[userId].scheduledTime;
    const [hour, minute] = scheduledTime.split(':').map(Number);

    // 初回通知のcronジョブ
    const notificationJob = cron.schedule(`${minute} ${hour} * * *`, async () => {
        if (!userSchedules[userId]) return; // ユーザーが削除された場合など

        await sendNotification(userId);
        userSchedules[userId].notified = true;
        startRescheduleNotification(userId); // 1時間ごとの再通知を開始
        notificationJob.stop(); // 初回通知ジョブは停止
        userSchedules[userId].cronJob = rescheduleJob; // 再通知ジョブを保存
    }, {
        scheduled: true,
        timezone: 'Asia/Tokyo'
    });
    userSchedules[userId].cronJob = notificationJob; // 初回通知ジョブを保存
}

// 1時間ごとの再通知スケジュールを開始する関数
function startRescheduleNotification(userId) {
    if (!userSchedules[userId] || !userSchedules[userId].notified) return; // 初回通知がまだ送信されていない場合は何もしない

    const rescheduleJob = cron.schedule('0 * * * *', async () => { // 毎時0分に実行
        if (!userSchedules[userId]) { // ユーザーが削除された場合など
            rescheduleJob.stop();
            return;
        }
        if (userSchedules[userId].notified) { // まだ通知が必要な場合
            await sendNotification(userId);
        } else {
            rescheduleJob.stop(); // 「飲んだ」ボタンが押されたら再通知を停止
            userSchedules[userId].cronJob = null;
        }
    }, {
        scheduled: true,
        timezone: 'Asia/Tokyo'
    });
    userSchedules[userId].cronJob = rescheduleJob; // 再通知ジョブを保存
}


// 通知を送信する関数
async function sendNotification(userId) {
    const message = {
        type: 'text',
        text: '薬を飲む時間ですよ！飲んだら「飲んだ」ボタンを押してくださいね。',
        quickReply: {
            items: [
                {
                    type: 'action',
                    action: {
                        type: 'message',
                        label: '飲んだ',
                        text: '飲んだ'
                    }
                }
            ]
        }
    };
    return client.pushMessage(userId, message);
}


app.post('/webhook', express.json());
app.post('/webhook', async (req, res) => {
    try {
        const events = req.body.events;
        await Promise.all(events.map(handleEvent));
        res.status(200).send('OK');
    } catch (error) {
        console.error(error);
        res.status(500).end();
    }
});


async function handleEvent(event) {
    if (event.type === 'message' && event.message.type === 'text') {
        const message = event.message.text;
        const userId = event.source.userId;

        if (message === '飲んだ') {
            if (userSchedules[userId] && userSchedules[userId].notified) {
                userSchedules[userId].notified = false; // 通知済みに設定解除
                if (userSchedules[userId].cronJob) {
                    userSchedules[userId].cronJob.stop(); // 再通知ジョブを停止
                    userSchedules[userId].cronJob = null;
                }
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '薬を飲んだんですね！えらいです！'
                });
            } else {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '確認ありがとうございます！'
                });
            }
        } else if (message.startsWith('時間設定 ')) { // 例: 「時間設定 9:00」
            const time = message.split(' ')[1];
            if (time && time.match(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)) { // 時刻フォーマットチェック
                setMedicineTime(userId, time);
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: `${time} に薬を飲む時間を設定しました。時間になったら通知しますね！`
                });
            } else {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '時間の形式が正しくありません。「時間設定 HH:MM」のように入力してください (例: 時間設定 9:00)。'
                });
            }
        } else if (message === 'リッチメニュー表示') { // リッチメニューを表示させるコマンド (テスト用)
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'リッチメニューを表示します',
            }).then(() => {
                return client.linkRichMenuToUser(userId, richMenuId);
            });
        } else if (message === 'リッチメニュー非表示') { // リッチメニューを非表示にするコマンド (テスト用)
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'リッチメニューを非表示にします',
            }).then(() => {
                return client.unlinkRichMenuFromUser(userId);
            });
        }
         else {
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: '「時間設定 HH:MM」で薬を飲む時間を設定してください。\n例: 時間設定 9:00\nリッチメニューを表示するには「リッチメニュー表示」と送信してください。'
            });
        }
    }
    return Promise.resolve(null);
}

// ポートの設定
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`ポート${port}でサーバー起動中`);
});