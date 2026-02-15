import type { AgentInputItem } from '@openai/agents';

/**
 * The OpenAI SDK compaction sometimes persists items in wire format
 * (with `image_url` / `file_id` keys) instead of SDK protocol format
 * (with `image` key). This function normalises those entries so the
 * SDK converter can produce a valid API request.
 *
 * It also strips large base64 data-URLs from image fields to prevent
 * session bloat.
 *
 * The function is idempotent — already-clean items pass through unchanged.
 */
export function sanitizeSessionItems(items: AgentInputItem[]): AgentInputItem[] {
  return items.map(sanitizeItem);
}

const BASE64_DATA_URL_RE = /^data:image\/[^;]+;base64,/;
const IMAGE_PLACEHOLDER = '[image previously analyzed]';

function sanitizeItem(item: AgentInputItem): AgentInputItem {
  // Only messages with array content can carry input_image parts
  if (!('content' in item) || !Array.isArray(item.content)) {
    return item;
  }

  let changed = false;
  const content = item.content.map((part: Record<string, unknown>) => {
    if (part.type !== 'input_image') {
      return part;
    }

    const patched = { ...part };
    let didPatch = false;

    // --- Wire-format → SDK protocol normalisation ---

    // Case 1: wire-format `image_url` string present, no `image`
    if (typeof patched.image_url === 'string' && patched.image_url && !patched.image) {
      patched.image = patched.image_url;
      didPatch = true;
    }

    // Case 2: wire-format `file_id` string present (non-null), no `image`
    if (typeof patched.file_id === 'string' && patched.file_id && !patched.image) {
      patched.image = { id: patched.file_id };
      didPatch = true;
    }

    // Clean up wire-format keys regardless
    if ('image_url' in patched) {
      delete patched.image_url;
      didPatch = true;
    }
    if ('file_id' in patched) {
      delete patched.file_id;
      didPatch = true;
    }

    // --- Base64 data-URL stripping ---
    // Replace the entire input_image part with input_text so the SDK
    // doesn't try to send the placeholder as an image_url.
    if (typeof patched.image === 'string' && BASE64_DATA_URL_RE.test(patched.image)) {
      changed = true;
      return { type: 'input_text', text: IMAGE_PLACEHOLDER };
    }

    if (didPatch) {
      changed = true;
      return patched;
    }
    return part;
  });

  if (!changed) {
    return item;
  }

  return { ...item, content } as AgentInputItem;
}
