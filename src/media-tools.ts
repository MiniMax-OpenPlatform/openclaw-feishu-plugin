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

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function error(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    error: message,
  };
}

// ============ Tool Implementations ============

/**
 * Upload an image to Feishu and get an image_key.
 */
async function doFeishuUploadImage(
  feishuCfg: FeishuConfig,
  params: { path: string; imageType?: "message" | "avatar" },
): Promise<{ content: Array<{ type: string; text: string }>; details: UploadImageResult }> {
  try {
    const { path: imagePath, imageType = "message" } = params;

    // Resolve ~ to home directory
    const resolvedPath = imagePath.startsWith("~")
      ? imagePath.replace("~", process.env.HOME ?? "")
      : imagePath;

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return error(new Error(`Image file not found: ${resolvedPath}`));
    }

    const result = await uploadImageFeishu({ cfg: { channels: { feishu: feishuCfg } } as any, image: resolvedPath, imageType });
    return json(result);
  } catch (err) {
    return error(err);
  }
}

/**
 * Upload a file to Feishu and get a file_key.
 */
async function doFeishuUploadFile(
  feishuCfg: FeishuConfig,
  params: { path: string; fileName?: string; fileType?: string; duration?: number },
): Promise<{ content: Array<{ type: string; text: string }>; details: UploadFileResult }> {
  try {
    const { path: filePath, fileName, fileType, duration } = params;

    // Resolve ~ to home directory
    const resolvedPath = filePath.startsWith("~")
      ? filePath.replace("~", process.env.HOME ?? "")
      : filePath;

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      return error(new Error(`File not found: ${resolvedPath}`));
    }

    const name = fileName || path.basename(resolvedPath);
    const type = (fileType as "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream") || detectFileType(name);

    const result = await uploadFileFeishu({
      cfg: { channels: { feishu: feishuCfg } } as any,
      file: resolvedPath,
      fileName: name,
      fileType: type,
      duration,
    });
    return json(result);
  } catch (err) {
    return error(err);
  }
}

/**
 * Download an image from Feishu using image_key.
 */
async function doFeishuDownloadImage(
  feishuCfg: FeishuConfig,
  params: { imageKey: string },
): Promise<{ content: Array<{ type: string; text: string }>; details: DownloadImageResult }> {
  try {
    const { imageKey } = params;

    const result = await downloadImageFeishu({ cfg: { channels: { feishu: feishuCfg } } as any, imageKey });

    // Convert to base64 data URL for the agent
    const base64 = result.buffer.toString("base64");
    const dataUrl = `data:${result.contentType || "image/png"};base64,${base64}`;

    return {
      content: [{ type: "text", text: `Downloaded image (${result.buffer.length} bytes, type: ${result.contentType || "unknown"})` }],
      details: { ...result, dataUrl },
    };
  } catch (err) {
    return error(err);
  }
}

/**
 * Download a message resource from Feishu.
 */
async function doFeishuDownloadFile(
  feishuCfg: FeishuConfig,
  params: { messageId: string; fileKey: string; type?: "image" | "file" },
): Promise<{ content: Array<{ type: string; text: string }>; details: DownloadMessageResourceResult }> {
  try {
    const { messageId, fileKey, type = "file" } = params;

    const result = await downloadMessageResourceFeishu({
      cfg: { channels: { feishu: feishuCfg } } as any,
      messageId,
      fileKey,
      type,
    });

    // Convert to base64 data URL for the agent
    const base64 = result.buffer.toString("base64");
    const dataUrl = `data:${result.contentType || "application/octet-stream"};base64,${base64}`;

    return {
      content: [{ type: "text", text: `Downloaded file (${result.buffer.length} bytes, type: ${result.contentType || "unknown"}, name: ${result.fileName || "unknown"})` }],
      details: { ...result, dataUrl },
    };
  } catch (err) {
    return error(err);
  }
}

/**
 * Send an image to a Feishu chat.
 */
async function doFeishuSendImage(
  feishuCfg: FeishuConfig,
  params: { to: string; imageKey: string; replyToMessageId?: string },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { to, imageKey, replyToMessageId } = params;

    const result = await sendImageFeishu({
      cfg: { channels: { feishu: feishuCfg } } as any,
      to,
      imageKey,
      replyToMessageId,
    });
    return json(result);
  } catch (err) {
    return error(err);
  }
}

/**
 * Send a file to a Feishu chat.
 */
async function doFeishuSendFile(
  feishuCfg: FeishuConfig,
  params: { to: string; fileKey: string; replyToMessageId?: string },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { to, fileKey, replyToMessageId } = params;

    const result = await sendFileFeishu({
      cfg: { channels: { feishu: feishuCfg } } as any,
      to,
      fileKey,
      replyToMessageId,
    });
    return json(result);
  } catch (err) {
    return error(err);
  }
}

// ============ Tool Registration ============

export function registerFeishuMediaTools(api: OpenClawPluginApi) {
  const feishuCfg = api.config?.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    api.logger.debug?.("feishu_media: Feishu credentials not configured, skipping media tools");
    return;
  }

  const toolsCfg = resolveToolsConfig(feishuCfg.tools);
  if (!toolsCfg.media) {
    api.logger.debug?.("feishu_media: media tool disabled in config");
    return;
  }

  // Register upload_image tool
  api.registerTool({
    name: "feishu_upload_image",
    label: "Feishu Upload Image",
    description:
      "Upload an image to Feishu from a local file path. Supports: JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO. Max size: 30MB. Returns an image_key for sending. Use the 'path' parameter to specify the file path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the image file to upload (e.g., /Users/xxx/Downloads/image.png)",
        },
        imageType: {
          type: "string",
          enum: ["message", "avatar"],
          description: "Type of image: 'message' for sending in chats, 'avatar' for profile pictures",
          default: "message",
        },
      },
      required: ["path"],
    },
    async execute(_toolCallId, params) {
      const toolInput = params as any;
      if (!toolInput.path) {
        return {
          content: [{ type: "text", text: "Error: 'path' parameter is required (local file path to the image)" }],
          error: "Missing required parameter",
        };
      }
      return doFeishuUploadImage(feishuCfg, {
        path: toolInput.path,
        imageType: toolInput.imageType,
      });
    },
  });

  // Register upload_file tool
  api.registerTool({
    name: "feishu_upload_file",
    label: "Feishu Upload File",
    description:
      "Upload a file to Feishu from a local file path. Supports: PDF, DOC, XLS, PPT, audio (opus/mp3), video (mp4), and other formats. Max size: 30MB. Returns a file_key for sending. Use the 'path' parameter to specify the file path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to upload (e.g., /Users/xxx/Downloads/document.pdf)",
        },
        fileName: {
          type: "string",
          description: "Name of the file (optional, will be extracted from path if not provided)",
        },
        fileType: {
          type: "string",
          enum: ["opus", "mp4", "pdf", "doc", "xls", "ppt", "stream"],
          description: "Type of file (auto-detected from fileName if not specified)",
        },
        duration: {
          type: "number",
          description: "Duration in milliseconds (required for audio/video files)",
        },
      },
      required: ["path"],
    },
    async execute(_toolCallId, params) {
      const toolInput = params as any;
      if (!toolInput.path) {
        return {
          content: [{ type: "text", text: "Error: 'path' parameter is required (local file path)" }],
          error: "Missing required parameter",
        };
      }
      return doFeishuUploadFile(feishuCfg, {
        path: toolInput.path,
        fileName: toolInput.fileName,
        fileType: toolInput.fileType,
        duration: toolInput.duration,
      });
    },
  });

  // Register download_image tool
  api.registerTool({
    name: "feishu_download_image",
    label: "Feishu Download Image",
    description: "Download an image from Feishu using an image_key. Returns the image as base64 data URL.",
    parameters: {
      type: "object",
      properties: {
        imageKey: {
          type: "string",
          description: "The image_key from a previously uploaded or received image",
        },
      },
      required: ["imageKey"],
    },
    async execute(_toolCallId, params) {
      const toolInput = params as any;
      return doFeishuDownloadImage(feishuCfg, {
        imageKey: toolInput.imageKey,
      });
    },
  });

  // Register download_file tool
  api.registerTool({
    name: "feishu_download_file",
    label: "Feishu Download File",
    description: "Download a file from Feishu using message_id and file_key. Returns the file as base64 data URL.",
    parameters: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The message_id containing the file",
        },
        fileKey: {
          type: "string",
          description: "The file_key from the message",
        },
        type: {
          type: "string",
          enum: ["image", "file"],
          description: "Type of resource: 'image' or 'file'",
          default: "file",
        },
      },
      required: ["messageId", "fileKey"],
    },
    async execute(_toolCallId, params) {
      const toolInput = params as any;
      return doFeishuDownloadFile(feishuCfg, {
        messageId: toolInput.messageId,
        fileKey: toolInput.fileKey,
        type: toolInput.type,
      });
    },
  });

  // Register send_image tool
  api.registerTool({
    name: "feishu_send_image",
    label: "Feishu Send Image",
    description: "Send an image to a Feishu chat using an image_key.",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "The chat ID (open_id or chat_id) to send the image to",
        },
        imageKey: {
          type: "string",
          description: "The image_key from feishu_upload_image",
        },
        replyToMessageId: {
          type: "string",
          description: "Optional message ID to reply to",
        },
      },
      required: ["to", "imageKey"],
    },
    async execute(_toolCallId, params) {
      const toolInput = params as any;
      return doFeishuSendImage(feishuCfg, {
        to: toolInput.to,
        imageKey: toolInput.imageKey,
        replyToMessageId: toolInput.replyToMessageId,
      });
    },
  });

  // Register send_file tool
  api.registerTool({
    name: "feishu_send_file",
    label: "Feishu Send File",
    description: "Send a file to a Feishu chat using a file_key.",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "The chat ID (open_id or chat_id) to send the file to",
        },
        fileKey: {
          type: "string",
          description: "The file_key from feishu_upload_file",
        },
        replyToMessageId: {
          type: "string",
          description: "Optional message ID to reply to",
        },
      },
      required: ["to", "fileKey"],
    },
    async execute(_toolCallId, params) {
      const toolInput = params as any;
      return doFeishuSendFile(feishuCfg, {
        to: toolInput.to,
        fileKey: toolInput.fileKey,
        replyToMessageId: toolInput.replyToMessageId,
      });
    },
  });

  api.logger.info?.("feishu_media: Media tools registered successfully");
}
