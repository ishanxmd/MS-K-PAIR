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
import pn from "awesome-phonenumber";
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
    let num = req.query.number;
    if (!num) return res.status(400).send({ code: "Phone number required" });

    num = num.replace(/[^0-9]/g, "");

    const phone = pn("+" + num);
    if (!phone.isValid()) {
        return res.status(400).send({
            code: "Invalid phone number. Use full international format without +",
        });
    }

    num = phone.getNumber("e164").replace("+", "");
    let dirs = "./" + num;

    await removeFile(dirs);

    const { state, saveCreds } = await useMultiFileAuthState(dirs);

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
            connectTimeoutMs: 60000,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, isNewLogin } = update;

            if (connection === "open") {
                console.log("✅ Connected");

                await delay(5000); // important delay

                try {
                    const credsPath = dirs + "/creds.json";

                    console.log("📤 Uploading session...");
                    const megaUrl = await upload(
                        credsPath,
                        `creds_${num}_${Date.now()}.json`
                    );

                    const megaFileId = getMegaFileId(megaUrl);
                    if (!megaFileId) throw new Error("Mega upload failed");

                    const userJid = jidNormalizedUser(
                        num + "@s.whatsapp.net"
                    );

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

                    console.log("✅ Messages sent");

                    await delay(5000);

                    removeFile(dirs);
                    process.exit(0);
                } catch (err) {
                    console.log("❌ Send error:", err);
                    removeFile(dirs);
                    process.exit(1);
                }
            }

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

        if (!sock.authState.creds.registered) {
            await delay(3000);

            try {
                let code = await sock.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join("-") || code;

                return res.send({ code });
            } catch (err) {
                console.log("Pairing error:", err);
                return res.status(503).send({
                    code: "Failed to get pairing code",
                });
            }
        }
    } catch (err) {
        console.log("Init error:", err);
        return res.status(503).send({ code: "Service Unavailable" });
    }
});

export default router;
