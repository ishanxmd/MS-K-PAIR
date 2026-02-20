
import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { upload } from "./mega.js";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+#[^\/]+)/);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

router.get("/", async (req, res) => {
    const sessionId =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    await removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();

            let responseSent = false;

            const KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" }),
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            KnightBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline, qr } =
                    update;

                if (qr && !responseSent) {
                    console.log(
                        "🟢 QR Code Generated! Scan it with your WhatsApp app.",
                    );

                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "M",
                            type: "image/png",
                            quality: 0.92,
                            margin: 1,
                            color: {
                                dark: "#000000",
                                light: "#FFFFFF",
                            },
                        });

                        if (!responseSent) {
                            responseSent = true;
                            console.log("QR Code sent to client");
                            res.send({
                                qr: qrDataURL,
                                message:
                                    "QR Code Generated! Scan it with your WhatsApp app.",
                                instructions: [
                                    "1. Open WhatsApp on your phone",
                                    "2. Go to Settings > Linked Devices",
                                    '3. Tap "Link a Device"',
                                    "4. Scan the QR code above",
                                ],
                            });
                        }
                    } catch (qrError) {
                        console.error("Error generating QR code:", qrError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({
                                code: "Failed to generate QR code",
                            });
                        }
                    }
                }

                if (connection === "open") {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Uploading session to MEGA...");

                    try {
                        const credsPath = dirs + "/creds.json";
                        const megaUrl = await upload(
                            credsPath,
                            `creds_qr_${sessionId}.json`,
                        );
                        const megaFileId = getMegaFileId(megaUrl);

                        if (megaFileId) {
                            console.log(
                                "✅ Session uploaded to MEGA. File ID:",
                                megaFileId,
                            );

                            const userJid = jidNormalizedUser(
                                KnightBot.authState.creds.me?.id || "",
                            );
                            if (userJid) {
                                await KnightBot.sendMessage(userJid, {
                                image: { url: "https://files.catbox.moe/jt7099.png" },
                                caption: `╔════════════════════◇
║ 『 SESSION CONNECTED 』
║ ✨ ISHAN-X-MD BETA 🔷
║ ✨ ISHAN-X MD OFFICIAL 🔷
╚════════════════════╝


╔════════════════════◇
║ 『 YOU'VE CHOSEN ISHAN-MD 』
║ ➤ Set the Session ID in Heroku:
║ ➤ SESSION_ID:
║
║ ⚠️ ~_*IMPORTANT:*_~
║ *~Do NOT share your Session ID with anyone.~* 
║ *~Keep it private and secure.~*
╚════════════════════╝


╔════════════════════◇
║ 『••• _V𝗶𝘀𝗶𝘁 𝗙𝗼𝗿_H𝗲𝗹𝗽 •••』
║❍ 𝐎𝐰𝐧𝐞𝐫: 94761638379
║❍ 𝐑𝐞𝐩𝐨: https://github.com/ishanxmd/ISHAN-X-BETA 
║❍ 𝐖𝐚𝐆𝗿𝐨𝐮𝐩: https://chat.whatsapp.com/C5jE3Tk7U0RBGcR6kwRSUi
║❍ 𝐖𝐚𝐂𝐡𝐚𝐧𝐧𝐞𝐥: https://whatsapp.com/channel/0029Vb7eEOGLY6dBNzl2IH0O
║❍ 𝐈𝐧𝐬𝐭𝐚𝐠𝐫𝐚𝐦: https://www.instagram.com/ishanmadusankerathnayake?igsh=MTE1aGVnOG80cWdjMQ==
║ ☬ ☬ ☬ ☬
╚═════════════════════╝
𒂀 Enjoy ISHAN-X MD BETA`,
                            });
                                
                                await KnightBot.sendMessage(userJid, {
                                    text: `ISHAN~${megaFileId}`,
                                });
                                console.log(
                                    "📄 MEGA file ID sent successfully",
                                );
                            } else {
                                console.log("❌ Could not determine user JID");
                            }
                        } else {
                            console.log("❌ Failed to upload to MEGA");
                        }

                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                        console.log("🎉 Process completed successfully!");

                        console.log("🛑 Shutting down application...");
                        await delay(2000);
                        process.exit(0);
                    } catch (error) {
                        console.error("❌ Error uploading to MEGA:", error);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via QR code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === "close") {
                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log(
                            "❌ Logged out from WhatsApp. Need to generate new QR code.",
                        );
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            KnightBot.ev.on("creds.update", saveCreds);

            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: "QR generation timeout" });
                    removeFile(dirs);
                    setTimeout(() => process.exit(1), 2000);
                }
            }, 30000);
        } catch (err) {
            console.error("Error initializing session:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" });
            }
            removeFile(dirs);
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

process.on("uncaughtException", (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (
        e.includes("Stream Errored") ||
        e.includes("Stream Errored (restart required)")
    )
        return;
    if (e.includes("statusCode: 515") || e.includes("statusCode: 503")) return;
    console.log("Caught exception: ", err);
    process.exit(1);
});

export default router;

  
