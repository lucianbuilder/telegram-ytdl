import { execa } from "execa"
import { InputFile } from "grammy"
import { deleteMessage, errorMessage } from "./botutil"
import { deniedMessage } from "./constants"
import { WHITELISTED_IDS } from "./environment"
import { Queue } from "./queue"
import { bot } from "./setup"
import { parseYtDlpInfo } from "./yt-dlp"

const queue = new Queue()

bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== "private") return

  await next()
})

//? filter out messages from non-whitelisted users
bot.on("message:text", async (ctx, next) => {
  if (WHITELISTED_IDS.includes(ctx.from?.id)) return next()

  await ctx.replyWithHTML(deniedMessage, {
    link_preview_options: { is_disabled: true },
  })
})

bot.on("message:text").on("::url", async (ctx, next) => {
  const [url] = ctx.entities("url")
  if (!url) return next()

  const processingMessage = await ctx.replyWithHTML("Processing...")

  queue.add(async () => {
    try {
      const { stdout } = await execa("yt-dlp", [
        "-f",
        `b[filesize_approx<${2e9}]`,
        "--no-playlist",
        "-J",
        url.text,
      ])

      const parsed = parseYtDlpInfo(stdout)
      const [download] = parsed.requested_downloads ?? []
      if (!download || !download.url) throw new Error("No download available")

      if (download.vcodec) {
        await ctx.replyWithVideo(new InputFile({ url: download.url }), {
          caption: parsed.title,
          reply_parameters: {
            message_id: ctx.message?.message_id,
            allow_sending_without_reply: true,
          },
        })
      } else {
        throw new Error("No video available")
      }
    } catch (error) {
      return error instanceof Error
        ? errorMessage(ctx.chat, error.message)
        : errorMessage(ctx.chat, `Couldn't download ${url}`)
    } finally {
      await deleteMessage(processingMessage)
    }
  })
})

bot.on("message:text", async (ctx) => {
  await ctx.replyWithHTML("You need to send an URL to download stuff.")
})
