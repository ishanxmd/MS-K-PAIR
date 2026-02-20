import express from "express";
import fs from "fs";
import pino from "pino";
import axios from "axios";
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
        if (fs.existsSync(FilePath)) {
            fs.rmSync(FilePath, { recursive: true, force: true });
        }
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+#[^\/]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

router.get("/", async (req, res) => {
    const sessionId =
        Date.now().toString() + Math.random().toString(36).slice(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    removeFile(dirs);

    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    let responseSent = false;

    try {
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "silent" })
                ),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.windows("Chrome"),
            markOnlineOnConnect: false,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // ===== QR GENERATE =====
            if (qr && !responseSent) {
                try {
                    const qrDataURL = await QRCode.toDataURL(qr);

                    responseSent = true;
                    res.send({
                        qr: qrDataURL,
                        message: "Scan QR with WhatsApp",
                    });
                } catch (err) {
                    responseSent = true;
                    res.status(500).send({ code: "QR generation failed" });
                }
            }

            // ===== CONNECTED =====
            if (connection === "open") {
                console.log("✅ Connected");

                await delay(5000); // very important

                try {
                    const credsPath = dirs + "/creds.json";

                    console.log("📤 Uploading session...");
                    const megaUrl = await upload(
                        credsPath,
                        `creds_qr_${sessionId}.json`
                    );

                    const megaFileId = getMegaFileId(megaUrl);
                    if (!megaFileId) throw new Error("Mega upload failed");

                    const rawJid = sock.authState.creds.me?.id;
                    if (!rawJid) throw new Error("User JID not found");

                    const userJid = jidNormalizedUser(rawJid);

                    // fetch image as buffer
                    const img = await axios.get(
                        "https://files.catbox.moe/jt7099.png",
                        { responseType: "arraybuffer" }
                    );

                    // send image
                    await sock.sendMessage(userJid, {
                        image: img.data,
                        caption: "HELLO",
                    });

                    await delay(3000);

                    // send session id
                    await sock.sendMessage(userJid, {
                        text: `ISHAN~${megaFileId}`,
                    });

                    console.log("✅ Messages sent successfully");

                    await delay(5000);

                    removeFile(dirs);
                    process.exit(0);
                } catch (err) {
                    console.log("❌ Send error:", err);
                    removeFile(dirs);
                    process.exit(1);
                }
            }

            // ===== CONNECTION CLOSE =====
            if (connection === "close") {
                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                if (statusCode !== 401) {
                    console.log("🔁 Reconnecting...");
                } else {
                    console.log("❌ Logged out");
                }
            }
        });

        // ===== QR TIMEOUT =====
        setTimeout(() => {
            if (!responseSent) {
                responseSent = true;
                res.status(408).send({ code: "QR timeout" });
                removeFile(dirs);
                process.exit(1);
            }
        }, 30000);
    } catch (err) {
        console.log("Init error:", err);
        if (!res.headersSent) {
            res.status(503).send({ code: "Service Unavailable" });
        }
        removeFile(dirs);
        process.exit(1);
    }
});

export default router;
