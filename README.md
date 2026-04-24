# Telegram Video Sticker MVP

Compact local MVP for Windows with one shared backend server, one in-memory queue, one ffmpeg-based converter, a simple web UI, and a Telegram bot that can create or extend sticker sets through the Bot API.

Official Telegram references used for this MVP:

- [Video sticker encoding guide](https://core.telegram.org/stickers/webm-vp9-encoding)
- [Sticker technical requirements](https://core.telegram.org/stickers)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## What this project includes

- `Express` backend as the central runtime
- `ngrok`-ready public access for the same backend
- web upload page at `/`
- shared conversion queue for web and bot
- shared ffprobe/ffmpeg conversion module
- Telegram bot on `telegraf`
- Bot API flows for `createNewStickerSet` and `addStickerToSet`
- JSON storage for user sticker set metadata and last converted sticker

## Project structure

```text
src/
  bot/
  config/
  converter/
  ffmpeg/
  queue/
  routes/
  server/
  storage/
  utils/
public/
uploads/
outputs/
data/
README.md
.env.example
package.json
```

## Telegram requirements baked into the converter

Telegram video stickers must be:

- `.webm` in a WebM container
- encoded with `VP9`
- `no audio`
- maximum `3 seconds`
- maximum `30 FPS`
- one side exactly `512 px`, the other side `<= 512 px`
- ideally looped
- targeted toward `<= 256 KB`

This MVP trims source videos to the first `3` seconds and retries encoding with more aggressive settings if the output is too large.

## 1. Install dependencies

Recommended: Node.js `20+` on Windows.

```bash
npm install
```

## 2. Install ffmpeg

Install `ffmpeg` and `ffprobe`, then make sure both are available in `PATH`.

Common Windows options:

- install from the official FFmpeg builds you trust
- or use a package manager such as `winget`

Example check:

```bash
ffmpeg -version
ffprobe -version
```

If these commands fail, the server will return a clear error that ffmpeg/ffprobe were not found in `PATH`.

## 3. Create `.env`

Copy `.env.example` to `.env` and fill in your values:

```env
PORT=3000
BASE_URL=http://localhost:3000
BOT_TOKEN=123456:replace_me
ADMIN_TOKEN=change-me-admin-token
IMAGE_PROVIDER=mock
IMAGE_PROVIDER_WEBHOOK_URL=
IMAGE_GENERATION_TIMEOUT_MS=120000
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-4.1
MAX_UPLOAD_MB=20
MAX_INPUT_DURATION_SEC=60
OUTPUT_TTL_MINUTES=60
MAX_CONCURRENT_JOBS=2
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

Notes:

- `BASE_URL` is used to generate download links for finished jobs.
- Without ngrok you can keep `BASE_URL=http://localhost:3000`.
- With ngrok you should replace it with your public HTTPS address.
- `FFMPEG_PATH` and `FFPROBE_PATH` are optional overrides if Windows has not refreshed `PATH` yet.
- `ADMIN_TOKEN` protects delete actions on `/admin` and `/api/admin/*`.

## 4. Run the local backend

Development mode:

```bash
npm run dev
```

Production-like local run:

```bash
npm start
```

The backend listens on the `PORT` from `.env`, by default `3000`.

Healthcheck:

```text
GET http://localhost:3000/health
```

## 5. Install and configure ngrok

ngrok is an explicit part of the intended flow for this MVP.

Install ngrok, then add your auth token:

```bash
ngrok config add-authtoken <TOKEN>
```

Start a tunnel to the local backend:

```bash
ngrok http 3000
```

ngrok will return a public URL like:

```text
https://abcd-12-34-56-78.ngrok-free.app
```

Now update `.env`:

```env
BASE_URL=https://abcd-12-34-56-78.ngrok-free.app
```

Then restart the server:

```bash
npm run dev
```

How ngrok fits the flow:

- the backend still runs locally on Windows
- ngrok exposes the same backend to the outside world
- web download links are generated from `BASE_URL`
- the bot can send users links that point to the same public backend

The server also works without ngrok for purely local testing, but the ngrok flow is intentionally documented and expected.

## 6. Run the Telegram bot

Set `BOT_TOKEN` in `.env`, then start the same backend process:

```bash
npm run dev
```

The bot is launched from the same Node.js process and uses:

- the same backend service
- the same in-memory queue
- the same conversion module
- the same storage folders

If `BOT_TOKEN` is empty, the server starts without the bot.

## 7. Web flow

1. Open `http://localhost:3000/`
2. Upload a video file
3. Press `Convert`
4. The page creates a job through `POST /api/convert`
5. The page polls `GET /api/jobs/:id`
6. When the job is `done`, download the result from `GET /api/files/:id`

Recent jobs are available in the UI and via `GET /api/jobs`.

## 8. Bot flow

1. Send the bot a `video`, `video_note`, `document` with video, or `.webm`
2. The bot replies `Обрабатываю...`
3. The bot downloads the file locally and submits it to the same backend queue
4. After conversion, the bot sends the finished `.webm`
5. The bot shows inline actions:
   - `➕ Создать новый набор`
   - `📦 Добавить в существующий`

Supported commands:

- `/start`
- `/help`
- `/pay`
- `/gen`
- `/sets`
- `/newpack`
- `/add`

Mini app stub:

- `/pay` opens a Telegram Mini App button
- the mini app is served from `GET /payment.html`
- this is currently a local stub with pricing cards and fake payment buttons
- later you can connect it to Telegram Payments or another provider

Image generation bot flow:

1. Run `/gen`
2. Send a source image
3. Send a prompt
4. The backend runs the `generate_sticker` pipeline through the configured provider
5. The bot returns a generated sticker and the same pack actions

## 9. Sticker set creation and update

This MVP does not use `@Stickers`.

It uses the Bot API methods:

- `uploadStickerFile`
- `createNewStickerSet`
- `addStickerToSet`

How to create a new pack:

1. Convert a video first
2. Press `➕ Создать новый набор` in the bot or run `/newpack`
3. Send only the pack title:

```text
Funny Cats
```

The bot will automatically create the final sticker set title in this form:

```text
Funny Cats | @funchu_bot
```

The final short name is normalized to Telegram format and generated in this form:

```text
funny_cats_by_funchu_bot
```

How to add to an existing pack:

1. Convert a video first
2. Press `📦 Добавить в существующий` or run `/add`
3. Choose one of the packs previously created by this bot for the current user

Stored in `data/users.json`:

- `user_id`
- known sticker sets created through this bot
- `lastConverted` sticker path/file id
- pending bot action

## 10. HTTP API

Endpoints:

- `GET /health` - server status
- `POST /api/convert` - upload a file and create a conversion job
- `GET /api/jobs/:id` - get job status: `queued`, `processing`, `done`, `failed`
- `GET /api/files/:id` - download converted `.webm`
- `GET /` - web page

Extra helper endpoint:

- `GET /api/jobs` - recent jobs for the UI

Admin endpoints:

- `GET /admin` - admin registry page
- `GET /api/admin/stickers` - list all tracked sticker sets and live stickers from Telegram
- `DELETE /api/admin/stickers/:fileId` - delete a sticker from a bot-created set
- `DELETE /api/admin/sets/:name` - delete a whole bot-created set

## 11. Queue design

The queue is intentionally simple:

- in-memory only
- no Redis
- one shared queue for web and bot jobs
- limited by `MAX_CONCURRENT_JOBS`
- statuses:
  - `queued`
  - `processing`
  - `done`
  - `failed`

Because it is in-memory, restarting the process clears active queue state. This is acceptable for MVP scope.

## 12. Base ffmpeg command

The converter uses `ffprobe` to validate the input and `ffmpeg` with a base command similar to:

```bash
ffmpeg -y -i input.mp4 -t 3 -an -c:v libvpx-vp9 -pix_fmt yuva420p ^
  -vf "fps=30,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=yuva420p" ^
  -b:v 0 -crf 34 -deadline good -cpu-used 2 -row-mt 1 output.webm
```

Adaptive retry strategy:

1. try normal quality
2. if file is too large, increase `CRF`
3. increase `CRF` again
4. if still too large, reduce `FPS`
5. if still too large, return a clear error

## 13. Security and guardrails

Included in this MVP:

- upload file size limit via `multer`
- ffmpeg/ffprobe execution through `execFile` without shell interpolation
- ffmpeg timeout
- ffprobe metadata validation
- safe generated filenames
- automatic cleanup of old uploads and outputs
- clear error when ffmpeg or ffprobe is missing from `PATH`

## 14. MVP limitations

- queue is in-memory only
- user state is stored in JSON only
- bot uses polling, not webhooks
- no authentication on the public web upload page
- no database
- no resumable uploads
- no persistent job recovery after restart
- conversion is optimized for compactness, not perfect visual quality
- transparent alpha preservation depends on the source file and ffmpeg behavior

## 15. TODO

- add webhook mode as an alternative bot runtime
- add persistent job storage
- add richer validation for already-compatible `.webm` inputs
- let users choose emoji before conversion finishes
- add better pack management and pack deletion tools
- show ffmpeg attempt details in the UI
- add automated integration tests
