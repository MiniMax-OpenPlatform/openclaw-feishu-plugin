import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import type { FeishuConfig } from "./types.js";
import { resolveToolsConfig } from "./tools-config.js";
import {
  uploadImageFeishu,
  uploadFileFeishu,
  sendImageFeishu,
  sendFileFeishu,
  downloadImageFeishu,
  downloadMessageResourceFeishu,
  detectFileType,
  type UploadImageResult,
  type UploadFileResult,
  type DownloadImageResult,
  type DownloadMessageResourceResult,
} from "./media.js";
import path from "path";
import fs from "fs";

/**
 * The channel key used in config: channels["feishu-new"]
 * Must match openclaw.plugin.json → id and channels[0].
 */
const CH = "feishu-new";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function errResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    error: message,
  };
}

/** Build a minimal ClawdbotConfig-shaped object that the media helpers can consume. */
function buildCfg(feishuCfg: FeishuConfig) {
  return { channels: { [CH]: feishuCfg } } as any;
}

// ============ Tool Implementations ============

async function doUploadImage(
  feishuCfg: FeishuConfig,
  params: { path: string; imageType?: "message" | "avatar" },
) {
  try {
    const { path: imagePath, imageType = "message" } = params;

    const resolvedPath = imagePath.startsWith("~")
      ? imagePath.replace("~", process.env.HOME ?? "")
      : imagePath;

    if (!fs.existsSync(resolvedPath)) {
      return errResult(new Error(`Image file not found: ${resolvedPath}`));
    }

    const result = await uploadImageFeishu({ cfg: buildCfg(feishuCfg), image: resolvedPath, imageType });
    return json(result);
  } catch (err) {
    return errResult(err);
  }
}

async function doUploadFile(
  feishuCfg: FeishuConfig,
  params: { path: string; fileName?: string; fileType?: string; duration?: number },
) {
  try {
    const { path: filePath, fileName, fileType, duration } = params;

    const resolvedPath = filePath.startsWith("~")
      ? filePath.replace("~", process.env.HOME ?? "")
      : filePath;

    if (!fs.existsSync(resolvedPath)) {
      return errResult(new Error(`File not found: ${resolvedPath}`));
    }

    const name = fileName || path.basename(resolvedPath);
    const type = (fileType as "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream") || detectFileType(name);

    const result = await uploadFileFeishu({
      cfg: buildCfg(feishuCfg),
      file: resolvedPath,
      fileName: name,
      fileType: type,
      duration,
    });
    return json(result);
  } catch (err) {
    return errResult(err);
  }
}

async function doDownloadImage(
  feishuCfg: FeishuConfig,
  params: { imageKey: string },
) {
  try {
    const result = await downloadImageFeishu({ cfg: buildCfg(feishuCfg), imageKey: params.imageKey });

    const base64 = result.buffer.toString("base64");
    const dataUrl = `data:${result.contentType || "image/png"};base64,${base64}`;

    return {
      content: [{ type: "text" as const, text: `Downloaded image (${result.buffer.length} bytes, type: ${result.contentType || "unknown"})` }],
      details: { ...result, dataUrl },
    };
  } catch (err) {
    return errResult(err);
  }
}

async function doDownloadFile(
  feishuCfg: FeishuConfig,
  params: { messageId: string; fileKey: string; type?: "image" | "file" },
) {
  try {
    const { messageId, fileKey, type = "file" } = params;

    const result = await downloadMessageResourceFeishu({
      cfg: buildCfg(feishuCfg),
      messageId,
      fileKey,
      type,
    });

    const base64 = result.buffer.toString("base64");
    const dataUrl = `data:${result.contentType || "application/octet-stream"};base64,${base64}`;

    return {
      content: [{ type: "text" as const, text: `Downloaded file (${result.buffer.length} bytes, type: ${result.contentType || "unknown"}, name: ${result.fileName || "unknown"})` }],
      details: { ...result, dataUrl },
    };
  } catch (err) {
    return errResult(err);
  }
}

async function doSendImage(
  feishuCfg: FeishuConfig,
  params: { to: string; imageKey: string; replyToMessageId?: string },
) {
  try {
    const result = await sendImageFeishu({
      cfg: buildCfg(feishuCfg),
      to: params.to,
      imageKey: params.imageKey,
      replyToMessageId: params.replyToMessageId,
    });
    return json(result);
  } catch (err) {
    return errResult(err);
  }
}

async function doSendFile(
  feishuCfg: FeishuConfig,
  params: { to: string; fileKey: string; replyToMessageId?: string },
) {
  try {
    const result = await sendFileFeishu({
      cfg: buildCfg(feishuCfg),
      to: params.to,
      fileKey: params.fileKey,
      replyToMessageId: params.replyToMessageId,
    });
    return json(result);
  } catch (err) {
    return errResult(err);
  }
}

// ============ Tool Registration ============

export function registerFeishuMediaTools(api: OpenClawPluginApi) {
  const feishuCfg = (api.config?.channels as Record<string, any>)?.[CH] as FeishuConfig | undefined;
  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    api.logger.debug?.("feishu_media: Feishu credentials not configured, skipping media tools");
    return;
  }

  const toolsCfg = resolveToolsConfig(feishuCfg.tools);
  if (!toolsCfg.media) {
    api.logger.debug?.("feishu_media: media tool disabled in config");
    return;
  }

  // ── feishu_upload_image ──
  api.registerTool({
    name: "feishu_upload_image",
    label: "Feishu Upload Image",
    description:
      "Upload an image to Feishu from a local file path. Supports: JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO. Max size: 30MB. Returns an image_key for sending.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the image file (e.g. /Users/xxx/Downloads/photo.png)",
        },
        imageType: {
          type: "string",
          enum: ["message", "avatar"],
          description: "Image usage type (default: message)",
          default: "message",
        },
      },
      required: ["path"],
    },
    async execute(_toolCallId, params: any) {
      if (!params.path) return errResult("'path' is required");
      return doUploadImage(feishuCfg, { path: params.path, imageType: params.imageType });
    },
  });

  // ── feishu_upload_file ──
  api.registerTool({
    name: "feishu_upload_file",
    label: "Feishu Upload File",
    description:
      "Upload a file to Feishu from a local file path. Supports: PDF, DOC, XLS, PPT, audio, video, etc. Max size: 30MB. Returns a file_key for sending.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file (e.g. /Users/xxx/Downloads/report.pdf)",
        },
        fileName: { type: "string", description: "Override file name (optional, extracted from path by default)" },
        fileType: {
          type: "string",
          enum: ["opus", "mp4", "pdf", "doc", "xls", "ppt", "stream"],
          description: "File type (auto-detected if omitted)",
        },
        duration: { type: "number", description: "Duration in ms (audio/video only)" },
      },
      required: ["path"],
    },
    async execute(_toolCallId, params: any) {
      if (!params.path) return errResult("'path' is required");
      return doUploadFile(feishuCfg, {
        path: params.path,
        fileName: params.fileName,
        fileType: params.fileType,
        duration: params.duration,
      });
    },
  });

  // ── feishu_download_image ──
  api.registerTool({
    name: "feishu_download_image",
    label: "Feishu Download Image",
    description: "Download an image from Feishu by image_key.",
    parameters: {
      type: "object",
      properties: {
        imageKey: { type: "string", description: "The image_key" },
      },
      required: ["imageKey"],
    },
    async execute(_toolCallId, params: any) {
      return doDownloadImage(feishuCfg, { imageKey: params.imageKey });
    },
  });

  // ── feishu_download_file ──
  api.registerTool({
    name: "feishu_download_file",
    label: "Feishu Download File",
    description: "Download a message attachment from Feishu by message_id + file_key.",
    parameters: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "The message_id containing the file" },
        fileKey: { type: "string", description: "The file_key" },
        type: { type: "string", enum: ["image", "file"], description: "Resource type (default: file)", default: "file" },
      },
      required: ["messageId", "fileKey"],
    },
    async execute(_toolCallId, params: any) {
      return doDownloadFile(feishuCfg, {
        messageId: params.messageId,
        fileKey: params.fileKey,
        type: params.type,
      });
    },
  });

  // ── feishu_send_image ──
  api.registerTool({
    name: "feishu_send_image",
    label: "Feishu Send Image",
    description: "Send an uploaded image to a Feishu chat.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Chat ID (oc_xxx) or user open_id (ou_xxx)" },
        imageKey: { type: "string", description: "image_key from feishu_upload_image" },
        replyToMessageId: { type: "string", description: "Optional message ID to reply to" },
      },
      required: ["to", "imageKey"],
    },
    async execute(_toolCallId, params: any) {
      return doSendImage(feishuCfg, {
        to: params.to,
        imageKey: params.imageKey,
        replyToMessageId: params.replyToMessageId,
      });
    },
  });

  // ── feishu_send_file ──
  api.registerTool({
    name: "feishu_send_file",
    label: "Feishu Send File",
    description: "Send an uploaded file to a Feishu chat.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Chat ID (oc_xxx) or user open_id (ou_xxx)" },
        fileKey: { type: "string", description: "file_key from feishu_upload_file" },
        replyToMessageId: { type: "string", description: "Optional message ID to reply to" },
      },
      required: ["to", "fileKey"],
    },
    async execute(_toolCallId, params: any) {
      return doSendFile(feishuCfg, {
        to: params.to,
        fileKey: params.fileKey,
        replyToMessageId: params.replyToMessageId,
      });
    },
  });

  api.logger.info?.("feishu_media: Media tools registered successfully");
}
