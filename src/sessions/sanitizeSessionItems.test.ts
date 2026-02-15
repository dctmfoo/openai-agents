import { describe, expect, it } from 'vitest';
import { sanitizeSessionItems } from './sanitizeSessionItems.js';
import type { AgentInputItem } from '@openai/agents';

const userMsg = (content: Record<string, unknown>[]): AgentInputItem =>
  ({
    type: 'message',
    role: 'user',
    content,
  }) as AgentInputItem;

describe('sanitizeSessionItems', () => {
  it('normalises wire-format image_url → protocol image', () => {
    const items = [
      userMsg([
        {
          type: 'input_image',
          detail: 'auto',
          file_id: null,
          image_url: 'https://example.com/photo.jpg',
        },
      ]),
    ];

    const [result] = sanitizeSessionItems(items);
    const part = (result as { content: Record<string, unknown>[] }).content[0];

    expect(part.image).toBe('https://example.com/photo.jpg');
    expect(part).not.toHaveProperty('image_url');
    expect(part).not.toHaveProperty('file_id');
    expect(part.detail).toBe('auto');
  });

  it('normalises wire-format file_id → protocol image: { id }', () => {
    const items = [
      userMsg([
        {
          type: 'input_image',
          detail: 'high',
          file_id: 'file-abc123',
          image_url: null,
        },
      ]),
    ];

    const [result] = sanitizeSessionItems(items);
    const part = (result as { content: Record<string, unknown>[] }).content[0];

    expect(part.image).toEqual({ id: 'file-abc123' });
    expect(part).not.toHaveProperty('file_id');
    expect(part).not.toHaveProperty('image_url');
  });

  it('replaces base64 data URL input_image with input_text placeholder', () => {
    const base64Url = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...longdata';
    const items = [
      userMsg([
        {
          type: 'input_image',
          detail: 'auto',
          file_id: null,
          image_url: base64Url,
        },
      ]),
    ];

    const [result] = sanitizeSessionItems(items);
    const part = (result as { content: Record<string, unknown>[] }).content[0];

    expect(part).toEqual({ type: 'input_text', text: '[image previously analyzed]' });
  });

  it('replaces base64 data URL from already-correct image field with input_text', () => {
    const items = [
      userMsg([
        {
          type: 'input_image',
          image: 'data:image/png;base64,iVBORw0KGgo...longdata',
          detail: 'auto',
        },
      ]),
    ];

    const [result] = sanitizeSessionItems(items);
    const part = (result as { content: Record<string, unknown>[] }).content[0];

    expect(part).toEqual({ type: 'input_text', text: '[image previously analyzed]' });
  });

  it('passes already-clean items through unchanged', () => {
    const items = [
      userMsg([
        {
          type: 'input_image',
          image: 'https://example.com/clean.jpg',
          detail: 'auto',
        },
      ]),
    ];

    const result = sanitizeSessionItems(items);
    expect(result).toEqual(items);
  });

  it('passes non-image content items through', () => {
    const items = [
      userMsg([{ type: 'input_text', text: 'hello world' }]),
    ];

    const result = sanitizeSessionItems(items);
    expect(result).toEqual(items);
  });

  it('removes null file_id and image_url keys', () => {
    const items = [
      userMsg([
        {
          type: 'input_image',
          image: 'https://example.com/photo.jpg',
          file_id: null,
          image_url: null,
          detail: 'auto',
        },
      ]),
    ];

    const [result] = sanitizeSessionItems(items);
    const part = (result as { content: Record<string, unknown>[] }).content[0];

    expect(part).not.toHaveProperty('file_id');
    expect(part).not.toHaveProperty('image_url');
    expect(part.image).toBe('https://example.com/photo.jpg');
  });

  it('handles mixed input_text + input_image content', () => {
    const items = [
      userMsg([
        { type: 'input_text', text: 'What is in this image?' },
        {
          type: 'input_image',
          detail: 'auto',
          file_id: null,
          image_url: 'https://example.com/photo.jpg',
        },
      ]),
    ];

    const [result] = sanitizeSessionItems(items);
    const content = (result as { content: Record<string, unknown>[] }).content;

    expect(content[0]).toEqual({ type: 'input_text', text: 'What is in this image?' });
    expect(content[1].image).toBe('https://example.com/photo.jpg');
    expect(content[1]).not.toHaveProperty('image_url');
    expect(content[1]).not.toHaveProperty('file_id');
  });

  it('handles items without content arrays (non-message items)', () => {
    const items = [
      { type: 'function_call', id: 'fc1', callId: 'c1', name: 'fn', arguments: '{}' },
    ] as AgentInputItem[];

    const result = sanitizeSessionItems(items);
    expect(result).toEqual(items);
  });

  it('handles string content on messages', () => {
    const items = [
      { type: 'message', role: 'user', content: 'plain text' },
    ] as AgentInputItem[];

    const result = sanitizeSessionItems(items);
    expect(result).toEqual(items);
  });
});
