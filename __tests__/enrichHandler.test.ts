import { EnrichDeps, handleEnrich, HandlerInput, smartSavesEnabled } from '../supabase/functions/_shared/enrichHandler';

const result = { title: 'Pad Thai', type: 'video' as const, tags: ['thai'], summary: 'Quick noodles.' };
const allowed = { data: { allowed: true, plan: 'free', used: 1, limit: 10, user_id: 'user_1' }, error: null };

function deps(over: Partial<EnrichDeps> = {}) {
  const d = {
    enabled: true,
    consumeCredit: jest.fn(async () => allowed),
    refundCredit: jest.fn(async () => ({ error: null })),
    linkContext: jest.fn(async () => 'Page title: Pad Thai'),
    askClaude: jest.fn(async () => result),
    log: jest.fn(),
    ...over,
  };
  return d as typeof d & EnrichDeps;
}
const post = (body: unknown = { url: 'https://example.com/pad-thai' }, authorization: string | null = 'Bearer token'): HandlerInput =>
  ({ method: 'POST', authorization, readJson: async () => body });

describe('server-side Smart Saves flag', () => {
  it.each([[undefined, false], ['', false], ['false', false], ['1', false], ['TRUE', false], ['yes', false], ['true', true]])(
    'SMART_SAVES_ENABLED=%p -> %p', (value, expected) => expect(smartSavesEnabled(value as string | undefined)).toBe(expected));

  it('when disabled, answers 503 and never touches credits, pages or Claude, even for a valid signed-in request', async () => {
    const d = deps({ enabled: false });
    const out = await handleEnrich(post(), d);
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ ok: false, reason: 'disabled' });
    expect(d.consumeCredit).not.toHaveBeenCalled();
    expect(d.linkContext).not.toHaveBeenCalled();
    expect(d.askClaude).not.toHaveBeenCalled();
    expect(d.refundCredit).not.toHaveBeenCalled();
  });

  it('when disabled, the flag wins before auth checks (no information about the request leaks)', async () => {
    const d = deps({ enabled: false });
    expect((await handleEnrich(post(undefined, null), d)).status).toBe(503);
  });

  it('CORS preflight still answers when disabled', async () => {
    expect(await handleEnrich({ method: 'OPTIONS', authorization: null, readJson: async () => ({}) }, deps({ enabled: false }))).toEqual({ status: 200, body: null });
  });
});

describe('enabled path (unchanged behaviour)', () => {
  it('no bearer token: 401 without using a credit', async () => {
    const d = deps();
    expect((await handleEnrich(post(undefined, null), d)).status).toBe(401);
    expect(d.consumeCredit).not.toHaveBeenCalled();
  });
  it('unreadable or private link: 400 without using a credit', async () => {
    const d = deps();
    expect((await handleEnrich(post({ url: 'http://169.254.169.254/' }), d)).status).toBe(400);
    expect(d.consumeCredit).not.toHaveBeenCalled();
  });
  it('invalid token (credit RPC errors): 401 and Claude is never called', async () => {
    const d = deps({ consumeCredit: jest.fn(async () => ({ data: null, error: { message: 'JWSError' } })) });
    expect((await handleEnrich(post(), d)).status).toBe(401);
    expect(d.askClaude).not.toHaveBeenCalled();
  });
  it('allowance used up: 402 and Claude is never called', async () => {
    const d = deps({ consumeCredit: jest.fn(async () => ({ data: { allowed: false, plan: 'free', used: 10, limit: 10, user_id: 'user_1' }, error: null })) });
    const out = await handleEnrich(post(), d);
    expect(out.status).toBe(402);
    expect(d.askClaude).not.toHaveBeenCalled();
  });
  it('success: one credit, one Claude call, 200', async () => {
    const d = deps();
    const out = await handleEnrich(post(), d);
    expect(out).toEqual({ status: 200, body: { ok: true, result, plan: { plan: 'free', used: 1, limit: 10 } } });
    expect(d.consumeCredit).toHaveBeenCalledTimes(1);
    expect(d.askClaude).toHaveBeenCalledTimes(1);
    expect(d.refundCredit).not.toHaveBeenCalled();
  });
});

describe('C-5: refund outcome decides what the user is told', () => {
  it('Claude fails and the refund succeeds: says no credit was used', async () => {
    const d = deps({ askClaude: jest.fn(async () => { throw new Error('timeout'); }) });
    const out = await handleEnrich(post(), d);
    expect(out.status).toBe(502);
    expect(d.refundCredit).toHaveBeenCalledWith('user_1');
    expect((out.body as { message: string }).message).toContain('weren’t charged');
  });
  it('Claude fails and the refund returns an error: does NOT claim no credit was used, and logs it', async () => {
    const d = deps({ askClaude: jest.fn(async () => { throw new Error('timeout'); }), refundCredit: jest.fn(async () => ({ error: { message: 'permission denied' } })) });
    const out = await handleEnrich(post(), d);
    expect(out.status).toBe(502);
    expect((out.body as { message: string }).message).not.toContain('charged');
    expect(d.log).toHaveBeenCalledWith('refund_ai_credit failed', { message: 'permission denied' });
  });
  it('the refund throws: still answers JSON, no false claim', async () => {
    const d = deps({ askClaude: jest.fn(async () => undefined), refundCredit: jest.fn(async () => { throw new Error('network'); }) });
    const out = await handleEnrich(post(), d);
    expect(out.status).toBe(422);
    expect((out.body as { message: string }).message).not.toContain('charged');
  });
});
