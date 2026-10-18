import { describe, expect, it, vi } from 'vitest';
import twinkle from '@fixtures/song-analysis/twinkle.json';
import { builtInDemo, isSongAnalysis, LoadError, loadDemo, loadUpload } from './song-loader';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeBuffer = { duration: 1 } as unknown as AudioBuffer;
const wav = () => new File([new Uint8Array([1, 2, 3])], 'song.wav', { type: 'audio/wav' });
const upload = { ...twinkle, song_id: 'upload-1a2b3c4d', title: 'song', source: { kind: 'upload', file_name: 'song.wav' } };

describe('isSongAnalysis', () => {
  it('accepts the fixtures and rejects other things', () => {
    expect(isSongAnalysis(twinkle)).toBe(true);
    expect(isSongAnalysis({ version: 1, song_id: 'x', tempo_bpm: 100, duration_sec: 1, parts: [] })).toBe(true);
    expect(isSongAnalysis(null)).toBe(false);
    expect(isSongAnalysis('<html>')).toBe(false);
    expect(isSongAnalysis({ detail: 'not found' })).toBe(false);
  });
});

describe('loadDemo', () => {
  it('asks the server for the demo analysis', async () => {
    const fetchFn = vi.fn(async () => json(twinkle));
    const song = await loadDemo(fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('/api/songs/demo-twinkle/analysis');
    expect(song.offline).toBe(false);
    expect(song.analysis.song_id).toBe('demo-twinkle');
  });

  it('uses the built-in demo when the server cannot be reached', async () => {
    const song = await loadDemo(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(song.offline).toBe(true);
    expect(song.analysis).toBe(builtInDemo);
  });

  it.each([
    ['a server error', () => json({ detail: 'boom' }, 500)],
    ['an unknown song', () => json({ detail: 'nope' }, 404)],
    ['a web page instead of JSON', () => new Response('<html></html>', { status: 200 })],
    ['JSON that is not a song', () => json({ hello: 'world' })],
  ])('uses the built-in demo after %s', async (_name, make) => {
    const song = await loadDemo(async () => make());
    expect(song.offline).toBe(true);
    expect(song.analysis.song_id).toBe('demo-twinkle');
  });
});

describe('loadUpload', () => {
  it('posts the file as multipart field "file" and returns the analysis with the decoded audio', async () => {
    const file = wav();
    const fetchFn = vi.fn(async () => json(upload));
    const song = await loadUpload(file, { fetchFn, decode: async () => fakeBuffer });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/songs');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(((init.body as FormData).get('file') as File).name).toBe('song.wav');
    expect(song).toMatchObject({ offline: false, buffer: fakeBuffer });
    expect(song.analysis.song_id).toBe('upload-1a2b3c4d');
  });

  it.each([
    ['cannot be reached', async () => Promise.reject(new TypeError('Failed to fetch'))],
    ['is behind a dev proxy that answers an empty 500', async () => new Response('', { status: 500 })],
    ['is down (502)', async () => new Response('Bad Gateway', { status: 502 })],
    ['is down (503)', async () => json({ detail: 'x' }, 503)],
    ['is down (504)', async () => new Response('', { status: 504 })],
    ['has no such address (404)', async () => json({ detail: 'x' }, 404)],
    ['does not take uploads here (405)', async () => json({ detail: 'x' }, 405)],
    ['answers with a web page', async () => new Response('<html></html>', { status: 200 })],
  ])('falls back to the built-in demo when the server %s, even if the file cannot be decoded', async (_name, answer) => {
    const song = await loadUpload(wav(), { fetchFn: answer, decode: async () => Promise.reject(new Error('bad data')) });
    expect(song.offline).toBe(true);
    expect(song.analysis).toBe(builtInDemo);
    expect(song.buffer).toBeUndefined();
  });

  it('gives friendly messages for files the server refuses', async () => {
    const decode = async () => fakeBuffer;
    await expect(loadUpload(wav(), { fetchFn: async () => new Response('<html>Bad</html>', { status: 400 }), decode })).rejects.toThrow(/could not read that file/);
    await expect(loadUpload(wav(), { fetchFn: async () => json({ detail: 'raw detail' }, 413), decode })).rejects.toThrow(/too big/);
    const err = await loadUpload(wav(), { fetchFn: async () => json({ detail: 'Traceback (most recent call last):\n  File "x.py"' }, 422), decode }).catch((e) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect(err.message).not.toMatch(/Traceback|422/);
    expect(err.message).toMatch(/could not read that file/);
  });

  it.each([
    [422, "I couldn't find a steady beat or a melody in that file. Try a song with a clear tune."],
    [500, 'We could not analyze that song. Please try another file.'],
    [415, 'That does not look like an audio file. Try an MP3, WAV, FLAC, OGG, M4A or AAC file.'],
    [400, 'That file is empty. Choose a different audio file.'],
  ])("shows the server's own reason for a %i and does not load the demo", async (status, detail) => {
    const err = await loadUpload(wav(), { fetchFn: async () => json({ detail }, status), decode: async () => fakeBuffer }).catch((e) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect(err.message).toBe(detail);
  });

  it('ignores reasons that are not one short line of words', async () => {
    const decode = async () => fakeBuffer;
    for (const detail of [[{ loc: ['body', 'file'], msg: 'Field required' }], '', 'x'.repeat(301), 'line one\nline two']) {
      const err = await loadUpload(wav(), { fetchFn: async () => json({ detail }, 422), decode }).catch((e) => e);
      expect(err).toBeInstanceOf(LoadError);
      expect(err.message).toMatch(/could not read that file/);
    }
  });

  it('says so when the browser cannot decode the audio', async () => {
    await expect(loadUpload(wav(), { fetchFn: async () => json(upload), decode: async () => Promise.reject(new Error('EncodingError')) })).rejects.toThrow(/could not play that file/);
  });

  it('says so when the server sends something that is not a song', async () => {
    await expect(loadUpload(wav(), { fetchFn: async () => json({ hello: 1 }), decode: async () => fakeBuffer })).rejects.toThrow(/could not understand/);
  });
});
