import asyncio
import os
import sys

import requests
from telethon import TelegramClient


def require_env(name):
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Required environment variable is missing: {name}")
    return value


async def main():
    api_id_str = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    channel_id_str = os.getenv("TELEGRAM_CHANNEL_ID")
    invite_link = os.getenv("TELEGRAM_INVITE_LINK", "")
    github_token = os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN")
    repository = os.getenv("RELEASE_REPOSITORY") or "Friderluvsu/stasher"
    tag = os.getenv("TARGET_TAG") or os.getenv("GITHUB_REF_NAME")

    if not all([api_id_str, api_hash, bot_token, channel_id_str, github_token]):
        print("⚠️ Telegram upload skipped: Required secrets are not configured.")
        return

    api_id = int(api_id_str)
    channel_id = int(channel_id_str)

    if not tag or tag == "main":
        raise RuntimeError(f"Invalid tag ({tag})")

    release_url = f"https://api.github.com/repos/{repository}/releases/tags/{tag}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {github_token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    print(f"Fetching assets for {tag} from {repository}...")
    response = requests.get(release_url, headers=headers, timeout=30)
    if response.status_code != 200:
        raise RuntimeError(
            f"Error fetching release {repository}@{tag}: HTTP {response.status_code}"
        )

    files = []
    for asset in response.json().get("assets", []):
        name = asset["name"]
        if not (
            name.endswith(("-arm64.dmg", "-x64.dmg", ".dmg"))
            or name.endswith(".exe")
        ):
            continue

        print(f"Downloading {name}...")
        download = requests.get(
            asset["browser_download_url"],
            headers=headers,
            stream=True,
            timeout=120,
        )
        download.raise_for_status()
        with open(name, "wb") as output:
            for chunk in download.iter_content(8192):
                if chunk:
                    output.write(chunk)
        files.append(name)

    if not files:
        print(f"No .dmg or .exe files found in {repository}@{tag} to upload to Telegram.")
        return

    print("🚀 Connecting to Telegram (Telethon MTProto)...")
    client = TelegramClient("bot_session", api_id, api_hash)
    await client.start(bot_token=bot_token)

    try:
        try:
            entity = await client.get_entity(channel_id)
        except Exception:
            if not invite_link:
                raise RuntimeError(
                    "Could not resolve Telegram channel entity and TELEGRAM_INVITE_LINK is empty"
                )
            print("🔗 Resolving channel via invite link...")
            try:
                entity = await client.get_entity(invite_link)
            except Exception as error:
                raise RuntimeError(
                    f"Could not resolve channel entity: {error}"
                ) from error

        print(f"📤 Uploading {len(files)} files to Telegram...")
        caption = f"🎵 **Stasher Release {tag}**\n\nAutomated desktop application build."
        await client.send_file(
            entity,
            files,
            caption=caption,
            force_document=True,
        )
        print("✅ All release files successfully sent to Telegram!")
    except Exception as error:
        raise RuntimeError(f"Error during Telegram upload: {error}") from error
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"❌ {error}", file=sys.stderr)
        raise
