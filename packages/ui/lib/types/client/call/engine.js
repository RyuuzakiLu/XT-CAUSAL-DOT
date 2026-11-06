/* ================================================================
   DOT 打电话 · 通话引擎（浏览器 / 安卓壳 WebView 共用）
   ▍这是什么
   一点“打电话”之后全程免手：持续听 → 自己判断说完（停顿 + 语义）→ 语音服务转文字
   → 用原生会话发给 DOT（对话记录、记忆、工具全部照旧）→ 回复边生成边分句
   → 语音服务边合成边念。用户一开口就先停下正在念的话，确认是插话再掐掉，
   只是噪音/回声就接着念。
   ▍铁律
   1. 麦克风始终开回声消除 + 降噪 + 自动增益；念话时判定“有人说话”的门槛自动抬高。
   2. 插话先“暂停”不“丢弃”：识别为空、只是语气词、或和刚念的话重合（回声）都续播。
   3. 电话不碰屏幕就能打完；安卓壳通过 DotNative 桥（call.*）和
      window 事件 dot-native-call 接前台服务、蓝牙、挂断键，网页侧不依赖它也能用。
   *更新：2026-10-27 · 新建*
================================================================ */
/* 全局只有一个引擎：输入栏的按键说话按钮从这里拿，不用再穿一层 props。 */
let currentEngine;
export const currentCallEngine = () => currentEngine;
const FRAME_MS = 20;
const MIC_RATE = 16000;
const TTS_RATE = 24000;
const PREROLL_FRAMES = 15;
/* 判断说完：短停顿先预识别，正常停顿提交，话没说完就多等一会儿。 */
const SPECULATE_MS = 220;
const END_MS = 720;
const LONG_END_MS = 2200;
const MAX_UTTERANCE_MS = 60000;
const STORAGE_VOICE = 'dot.call.voice';
const FILLER = /^(嗯+|啊+|呃+|额+|哦+|噢+|喂+|哎+|诶+|唉+|哈+|嘿+|呐+|喵+|uh|um|hmm|ah|oh)$/i;
const DANGLING = /(然后|还有|而且|但是|不过|可是|所以|因为|如果|要是|就是|那个|这个|那么|比如|或者|还是|以及|以后|之后|的话|帮我|给我|让我|我想|我要|我觉得|我记得|你帮我|你给我|你去|你先|一下|和|跟|与|把|给|让|对|从|往|在|当|我|你|他|她|就|再|先|还|也|都|又|要|想|能|会|可以|是|的是|有)$/;
const CLOSED = /(吗|呢|吧|啊|呀|嘛|啦|咯|了|的|好|行|对|是的|没事|谢谢|再见|拜拜)$/;
/** 语义判断：这句话是不是还没说完。返回 'complete' | 'incomplete' | 'filler'。 */
export function judgeUtterance(raw) {
    const text = raw.replace(/\s+/g, '').trim();
    if (!text)
        return 'empty';
    const bare = text.replace(/[。，、！？!?,.…~～；;：:"“”‘’'（）()]/g, '');
    if (!bare)
        return 'empty';
    if (FILLER.test(bare))
        return 'filler';
    if (/[，,、：:…]$|\.\.\.$|[～~]$/.test(text))
        return 'incomplete';
    if (/[？?！!]$/.test(text))
        return 'complete';
    const tail = bare.replace(/[啊呀呢]$/, '');
    if (CLOSED.test(bare) && !/(然后|就是)的$/.test(bare))
        return 'complete';
    if (DANGLING.test(tail))
        return 'incomplete';
    return 'complete';
}
/** 给语音合成用的文字清理：去掉 Markdown、链接、表情和代码。 */
export function speakable(raw) {
    return raw
        .replace(/〔电话〕/g, '')
        .replace(/\[m:[A-Za-z0-9_.:-]+\]/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
        .replace(/https?:\/\/\S+/g, '链接')
        .replace(/`+/g, '')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
        .replace(/\*\*|__|~~|\*/g, '')
        .replace(/\|/g, '，')
        .replace(/\p{Extended_Pictographic}|\uFE0F/gu, '')
        .replace(STRAY_LATIN, (m, head, offset, all) => (/[\u3400-\u9fff]/.test(all) ? head : m))
        .replace(/\s+/g, ' ')
        .trim();
}
/** 快模型偶尔在中文句子中间蹦出毫不相干的小写英文词（实测见过 lakehouse、density、activity）。
 *  只在念的时候去掉：两边都是中文或中文标点、全小写、至少 4 个字母。字幕和对话里的原文不动；大写开头的名字（DOT、Python）照念。 */
const STRAY_LATIN = /(^|[\u3400-\u9fff\u3000-\u303f\uff00-\uffef])\s*[a-z]{4,}(?:\s+[a-z]{4,})*\s*(?=[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]|$)/g;
/** 回复开头的短口头语（“好呀，”“嗯……”）。单独切成第一句：服务端缓存了它们的音频，能立刻出声。 */
const OPENER = /^\s*(嗯+|嗯嗯|好呀|好啊|好的|好嘞|好|行|可以|当然可以|当然|没问题|哈哈+|我看看|我想想|让我想想|我查查|你好呀|你好|在呢|来啦|是的|对)\s*[，,。！!？?、：:；;…~～—]+/;
/** 流式分句：第一句尽早切（压低首句延迟），后面按整句切。 */
export class Segmenter {
    emit;
    buffer = '';
    inCode = false;
    emitted = 0;
    constructor(emit) {
        this.emit = emit;
    }
    push(delta) {
        for (const line of delta.split(/(```)/)) {
            if (line === '```') {
                this.inCode = !this.inCode;
                if (this.inCode)
                    this.cut(true);
                continue;
            }
            if (!this.inCode)
                this.buffer += line;
        }
        this.cut(false);
    }
    finish() { this.cut(true); }
    cut(force) {
        for (;;) {
            const text = this.buffer;
            if (!text)
                return;
            let index = -1;
            if (this.emitted === 0) {
                const om = OPENER.exec(text);
                if (om)
                    index = om[0].length;
            }
            const hard = /[。！？!?；;\n]|\.(?=\s|$)/g;
            let m;
            while (index < 0 && (m = hard.exec(text))) {
                if (speakable(text.slice(0, m.index)).length >= 2) {
                    index = m.index + 1;
                    break;
                }
            }
            if (index < 0) {
                const softMin = this.emitted === 0 ? 7 : 26;
                if (speakable(text).length >= softMin) {
                    const soft = /[，,、：:]/g;
                    while ((m = soft.exec(text))) {
                        if (speakable(text.slice(0, m.index)).length >= (this.emitted === 0 ? 5 : 14)) {
                            index = m.index + 1;
                            break;
                        }
                    }
                }
            }
            if (index < 0 && speakable(text).length > 90)
                index = text.length;
            if (index < 0 && force)
                index = text.length;
            if (index < 0)
                return;
            const piece = speakable(text.slice(0, index));
            this.buffer = text.slice(index);
            if (piece && /[\p{L}\p{N}]/u.test(piece)) {
                this.emitted++;
                this.emit(piece);
            }
        }
    }
}
const WORKLET = `
class DotMic extends AudioWorkletProcessor {
  constructor(options) { super(); this.ratio = sampleRate / ${MIC_RATE}; this.acc = 0; this.sum = 0; this.n = 0; this.frame = new Int16Array(${(MIC_RATE * FRAME_MS) / 1000}); this.fi = 0; this.energy = 0 }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input) return true
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]; this.n++; this.acc += 1
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio
        const v = Math.max(-1, Math.min(1, this.sum / this.n)); this.sum = 0; this.n = 0
        this.energy += v * v
        this.frame[this.fi++] = v < 0 ? v * 0x8000 : v * 0x7fff
        if (this.fi === this.frame.length) {
          const rms = Math.sqrt(this.energy / this.frame.length)
          this.port.postMessage({ pcm: this.frame.buffer, rms }, [this.frame.buffer])
          this.frame = new Int16Array(${(MIC_RATE * FRAME_MS) / 1000}); this.fi = 0; this.energy = 0
        }
      }
    }
    return true
  }
}
registerProcessor('dot-mic', DotMic)
`;
function nativeBridge() { return globalThis.DotNative; }
let nativeSeq = 0;
/** 通知安卓壳（没有壳时什么也不做）。方法名见 docs/打电话-安卓壳接入.md。 */
function notifyNative(method, payload = {}) {
    const bridge = nativeBridge();
    if (!bridge)
        return;
    try {
        bridge.call(method, `dot-call-${++nativeSeq}`, JSON.stringify(payload));
    }
    catch { /* 壳不支持就算了 */ }
}
export class CallEngine {
    turn;
    wsUrl;
    snapshot;
    listeners = new Set();
    ws;
    stream;
    micCtx;
    playCtx;
    worklet;
    noiseFloor = 0.004;
    echoFloor = 0.01;
    level = 0;
    speechRun = 0;
    silenceRun = 0;
    inUtterance = false;
    utteranceId = 0;
    utteranceFrames = 0;
    lastSpeechFrame = 0;
    speculative;
    asrSeq = 0;
    asrWaiters = new Map();
    judgedIncomplete = false;
    finalizing = false;
    preroll = [];
    bargePaused = false;
    turnAbort;
    turnBusy = false;
    segSeq = 0;
    segText = new Map();
    pendingSegs = new Set();
    sources = new Set();
    nextPlayAt = 0;
    recentSpoken = [];
    pingTimer;
    reconnects = 0;
    timing;
    timings = [];
    /** 调试用：插话、回声、噪音的判定记录（只在内存里，最多 60 条） */
    events = [];
    note(kind, text) { this.events.push(text === undefined ? { at: Date.now(), kind } : { at: Date.now(), kind, text }); if (this.events.length > 60)
        this.events.shift(); }
    wantOpen = false;
    dotLine = '';
    constructor(turn, wsUrl = defaultWsUrl) {
        this.turn = turn;
        this.wsUrl = wsUrl;
        const voice = (() => { try {
            return localStorage.getItem(STORAGE_VOICE) ?? '冰糖';
        }
        catch {
            return '冰糖';
        } })();
        this.snapshot = { phase: 'idle', muted: false, startedAt: 0, you: '', dot: '', voice, voices: ['冰糖', '茉莉', '苏打', '白桦'], mode: 'call' };
        currentEngine = this;
        if (typeof window !== 'undefined') {
            window.addEventListener('dot-native-call', event => this.onNativeEvent(event.detail));
            window.DotCall = {
                start: () => this.start(), ptt: (down) => down ? this.pttDown() : this.pttUp(), hangup: () => this.hangup(), toggleMute: () => this.toggleMute(),
                state: () => this.snapshot, timings: () => this.timings.slice(-20), events: () => this.events.slice(),
                probe: () => ({ level: this.level, noiseFloor: this.noiseFloor, echoFloor: this.echoFloor, playing: this.isPlaying(), inUtterance: this.inUtterance, speechRun: this.speechRun }),
            };
        }
    }
    /* ---------- 对外 ---------- */
    subscribe = (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    getSnapshot = () => this.snapshot;
    getLevel = () => this.level;
    get active() { return !['idle', 'ended', 'error'].includes(this.snapshot.phase); }
    async start(mode = 'call') {
        if (this.active) {
            // 按键说话时点了打电话：直接切成通话，连接和麦克风都不用重建
            if (mode === 'call' && this.snapshot.mode === 'ptt') {
                this.holding = false;
                this.holdWanted = false;
                clearInterval(this.idleTimer);
                this.set({ mode: 'call', startedAt: Date.now() });
                notifyNative('call.start', { title: '正在和 DOT 通话' });
            }
            return;
        }
        this.set({ phase: 'connecting', startedAt: Date.now(), you: '', dot: '', error: undefined, notice: undefined, muted: false, mode });
        this.wantOpen = true;
        if (mode === 'call')
            notifyNative('call.start', { title: '正在和 DOT 通话' });
        else {
            this.lastActive = Date.now();
            clearInterval(this.idleTimer);
            this.idleTimer = setInterval(() => this.checkIdle(), 5000);
        }
        try {
            // 麦克风和播放都要在这次点击里建好，移动端才允许出声。
            this.playCtx = new AudioContext({ sampleRate: TTS_RATE, latencyHint: 'interactive' });
            void this.playCtx.resume();
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
            this.micCtx = new AudioContext({ latencyHint: 'interactive' });
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
            await this.micCtx.audioWorklet.addModule(url);
            URL.revokeObjectURL(url);
            const source = this.micCtx.createMediaStreamSource(this.stream);
            this.worklet = new AudioWorkletNode(this.micCtx, 'dot-mic');
            this.worklet.port.onmessage = event => this.onFrame(event.data);
            const sink = this.micCtx.createGain();
            sink.gain.value = 0;
            source.connect(this.worklet).connect(sink).connect(this.micCtx.destination);
            void this.micCtx.resume();
            const track = this.stream.getAudioTracks()[0];
            track?.addEventListener('ended', () => { if (this.active)
                this.fail('麦克风被系统收回了（可能来了电话或切换了音频设备）'); });
            this.set({ route: track?.label || undefined });
            await this.connect();
        }
        catch (cause) {
            const name = cause?.name;
            this.fail(name === 'NotAllowedError' ? '没有麦克风权限：请在浏览器或 App 设置里允许 DOT 使用麦克风' : name === 'NotFoundError' ? '没找到麦克风' : `电话没接通：${cause?.message ?? cause}`);
        }
    }
    hangup(reason) {
        if (!this.active && this.snapshot.phase !== 'error')
            return;
        this.wantOpen = false;
        this.holding = false;
        this.holdWanted = false;
        clearInterval(this.idleTimer);
        const wasPtt = this.snapshot.mode === 'ptt';
        this.teardown();
        if (wasPtt) {
            this.set({ phase: 'idle', mode: 'call', notice: undefined, error: undefined });
            return;
        }
        this.set({ phase: 'ended', notice: reason });
        notifyNative('call.end', {});
        setTimeout(() => { if (this.snapshot.phase === 'ended')
            this.set({ phase: 'idle' }); }, 1600);
    }
    toggleMute() {
        const muted = !this.snapshot.muted;
        this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
        if (muted && this.inUtterance)
            this.dropUtterance();
        this.set({ muted });
        notifyNative('call.state', { muted });
    }
    setVoice(voice) {
        if (!this.snapshot.voices.includes(voice))
            return;
        try {
            localStorage.setItem(STORAGE_VOICE, voice);
        }
        catch { /* 无存储也能打 */ }
        this.set({ voice });
        this.send({ t: 'voice', voice });
    }
    /** 换声音后用新声音说一句试听（不进对话记录）。 */
    previewVoice() {
        if (!this.active || this.turnBusy || this.inUtterance)
            return;
        this.stopPlayback();
        this.send({ t: 'hush' });
        this.speak(`我是 DOT，以后就用这个声音和你说话。`);
    }
    /* ---------- 按键说话 ---------- */
    holding = false;
    holdWanted = false;
    lastActive = 0;
    idleTimer;
    /** 按下：没连上就先连（麦克风权限也在这一下里要）；DOT 正在念或正在想，直接打断，不弹确认。 */
    async pttDown() {
        if (this.active && this.snapshot.mode === 'call')
            return;
        this.holdWanted = true;
        this.lastActive = Date.now();
        if (!this.active) {
            await this.start('ptt');
            if (!this.active || this.snapshot.mode !== 'ptt')
                return;
        }
        if (!this.holdWanted)
            return;
        if (this.isPlaying() || this.pendingSegs.size || this.turnBusy) {
            this.interruptReply();
            this.note('ptt-interrupt');
        }
        if (this.inUtterance)
            this.endUtterance();
        this.holding = true;
        this.preroll = [];
        this.silenceRun = 0;
        this.beginUtterance(false);
        this.set({ phase: 'hearing' });
    }
    /** 松开（或再点一下）：这段话录完了，直接识别，不再等停顿。 */
    pttUp() {
        this.holdWanted = false;
        this.lastActive = Date.now();
        if (!this.holding)
            return;
        this.holding = false;
        if (this.inUtterance) {
            this.silenceRun = 0;
            void this.finalize(true);
        }
    }
    /** 按键说话的回复不想听了：停止朗读（文字照常留在对话里）。 */
    stopReading() { if (this.snapshot.mode === 'ptt') {
        this.interruptReply();
        this.set({ phase: 'listening' });
    } }
    get recording() { return this.holding; }
    /* 按键说话空闲一阵就把麦克风和连接都关掉，免得一直占着麦克风。 */
    checkIdle() {
        if (this.snapshot.mode !== 'ptt' || !this.active)
            return;
        if (this.holding || this.inUtterance || this.turnBusy || this.isPlaying() || this.pendingSegs.size) {
            this.lastActive = Date.now();
            return;
        }
        if (Date.now() - this.lastActive > 60_000)
            this.hangup();
    }
    /** 关掉报错后的通话层。 */
    dismiss() { if (!this.active)
        this.set({ phase: 'idle', error: undefined, notice: undefined }); }
    /** 给管理/测试用：省掉麦克风，直接把一句文字当作用户说的话。 */
    injectText(text) { this.timing = { at: Date.now(), speechEnd: Date.now() }; void this.submit(text); }
    /* ---------- 连接 ---------- */
    async connect() {
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl());
            ws.binaryType = 'arraybuffer';
            this.ws = ws;
            let opened = false;
            const timer = setTimeout(() => { if (!opened) {
                ws.close();
                reject(new Error('连不上语音服务（超时）'));
            } }, 25000);
            ws.onopen = () => { opened = true; };
            ws.onmessage = event => {
                if (typeof event.data === 'string') {
                    const msg = JSON.parse(event.data);
                    if (msg.t === 'ready') {
                        clearTimeout(timer);
                        if (!msg.configured) {
                            reject(new Error('语音服务尚未完成配置'));
                            return;
                        }
                        this.send({ t: 'voice', voice: this.snapshot.voice });
                        resolve();
                    }
                    this.onServer(msg);
                }
                else
                    this.onAudio(event.data);
            };
            ws.onclose = () => {
                clearTimeout(timer);
                if (!opened) {
                    reject(new Error('连不上语音服务'));
                    return;
                }
                if (this.ws === ws)
                    this.onSocketLost();
            };
        });
        this.reconnects = 0;
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'ping', at: Date.now() }), 15000);
        if (this.snapshot.phase === 'connecting' || this.snapshot.phase === 'reconnecting')
            this.set({ phase: 'listening', notice: undefined });
        // 重连期间 DOT 已经开始回复时，状态会先变成“思考/念话”，提示条要单独清掉，否则一直挂着“网络断了一下”。
        else if (this.snapshot.notice === '网络断了一下，正在重连…')
            this.set({ notice: undefined });
    }
    onSocketLost() {
        if (!this.wantOpen)
            return;
        this.ws = undefined;
        if (this.inUtterance)
            this.dropUtterance();
        this.stopPlayback();
        if (this.reconnects >= 4) {
            this.fail('语音服务连接断开，重连没成功');
            return;
        }
        this.reconnects++;
        this.set({ phase: 'reconnecting', notice: '网络断了一下，正在重连…' });
        setTimeout(() => { if (this.wantOpen)
            this.connect().catch(() => this.onSocketLost()); }, 800 * this.reconnects);
    }
    send(value) { if (this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(JSON.stringify(value)); }
    /* ---------- 听 ---------- */
    onFrame({ pcm, rms }) {
        this.level = this.level * 0.6 + rms * 0.4;
        if (!this.active || this.snapshot.muted || this.snapshot.phase === 'connecting' || this.snapshot.phase === 'reconnecting')
            return;
        if (this.snapshot.mode === 'ptt') {
            if (this.holding && this.inUtterance) {
                this.sendFrame(pcm);
                if (rms > Math.max(this.noiseFloor * 3, 0.011))
                    this.lastSpeechFrame = this.utteranceFrames;
            }
            else if (!this.inUtterance)
                this.noiseFloor = rms > this.noiseFloor ? this.noiseFloor * 0.995 + rms * 0.005 : this.noiseFloor * 0.9 + rms * 0.1;
            return;
        }
        const playing = this.isPlaying();
        if (!this.inUtterance) {
            // 没人说话时学习底噪；念话时单独学习“回声底噪”
            // 回声底噪只在“没有疑似开口”时学，而且往上涨得慢；以前会把用户插话本身当成回声学进去，门槛跟着涨，插话永远触发不了。
            if (playing) {
                if (this.speechRun === 0)
                    this.echoFloor = rms > this.echoFloor ? this.echoFloor * 0.995 + rms * 0.005 : this.echoFloor * 0.9 + rms * 0.1;
            }
            else
                this.noiseFloor = rms > this.noiseFloor ? this.noiseFloor * 0.995 + rms * 0.005 : this.noiseFloor * 0.9 + rms * 0.1;
            this.preroll.push(pcm);
            if (this.preroll.length > PREROLL_FRAMES)
                this.preroll.shift();
        }
        const threshold = playing ? Math.max(this.noiseFloor * 4.5, this.echoFloor * 2.6, 0.028) : Math.max(this.noiseFloor * 3, 0.011);
        const voiced = rms > (this.inUtterance ? threshold * 0.6 : threshold);
        if (voiced) {
            this.speechRun++;
            this.silenceRun = 0;
        }
        else {
            this.silenceRun++;
            if (this.speechRun > 0 && !this.inUtterance)
                this.speechRun = Math.max(0, this.speechRun - (playing ? 1 : 2));
        }
        const needRun = playing ? 12 : 5;
        if (!this.inUtterance && this.speechRun >= needRun)
            this.beginUtterance(playing);
        if (!this.inUtterance)
            return;
        this.sendFrame(pcm);
        if (voiced) {
            this.lastSpeechFrame = this.utteranceFrames;
            if (this.judgedIncomplete)
                this.judgedIncomplete = false;
            this.speculative = this.speculative && this.speculative.covered >= this.utteranceFrames ? this.speculative : undefined;
        }
        const silentMs = this.silenceRun * FRAME_MS;
        if (this.finalizing)
            return;
        if (this.utteranceFrames * FRAME_MS > MAX_UTTERANCE_MS) {
            void this.finalize(true);
            return;
        }
        if (silentMs >= SPECULATE_MS && !this.speculative && !voiced)
            this.speculative = this.requestAsr();
        if (!this.judgedIncomplete && silentMs >= END_MS)
            void this.finalize(false);
        else if (this.judgedIncomplete && silentMs >= LONG_END_MS)
            void this.finalize(true);
    }
    beginUtterance(playing) {
        this.inUtterance = true;
        this.utteranceId++;
        this.utteranceFrames = 0;
        this.lastSpeechFrame = 0;
        this.speculative = undefined;
        this.judgedIncomplete = false;
        this.finalizing = false;
        this.send({ t: 'u_start', u: this.utteranceId });
        for (const frame of this.preroll)
            this.sendFrame(frame);
        this.preroll = [];
        if (playing || this.pendingSegs.size) {
            this.pausePlayback();
            this.bargePaused = true;
            this.note('barge-pause');
        }
        else
            this.note('speech-start');
        announce('listening', true);
        this.set({ phase: 'hearing' });
    }
    sendFrame(pcm) {
        this.utteranceFrames++;
        if (this.ws?.readyState !== WebSocket.OPEN)
            return;
        const frame = new Uint8Array(5 + pcm.byteLength);
        frame[0] = 2;
        new DataView(frame.buffer).setUint32(1, this.utteranceId);
        frame.set(new Uint8Array(pcm), 5);
        this.ws.send(frame);
    }
    requestAsr() {
        const r = ++this.asrSeq;
        const covered = this.utteranceFrames;
        const promise = new Promise(resolve => {
            this.asrWaiters.set(r, resolve);
            setTimeout(() => { if (this.asrWaiters.delete(r))
                resolve({ ok: false, text: '', error: '识别超时' }); }, 20000);
        });
        this.send({ t: 'u_asr', u: this.utteranceId, r });
        return { r, covered, promise };
    }
    async finalize(force) {
        if (this.finalizing)
            return;
        this.finalizing = true;
        const u = this.utteranceId;
        const speechEnd = Date.now() - this.silenceRun * FRAME_MS;
        const spec = this.speculative && this.speculative.covered >= this.lastSpeechFrame ? this.speculative : this.requestAsr();
        const asrAsked = Date.now();
        const result = await spec.promise;
        if (u !== this.utteranceId || !this.inUtterance)
            return;
        // 等识别时用户又开口了：继续听，稍后整句重新识别
        if (this.lastSpeechFrame > spec.covered) {
            this.finalizing = false;
            this.speculative = undefined;
            return;
        }
        const text = result.text.trim();
        const verdict = result.ok ? judgeUtterance(text) : 'empty';
        if (!result.ok && result.error)
            this.set({ notice: `没听清：${result.error}` });
        if (!force && verdict === 'incomplete') {
            this.judgedIncomplete = true;
            this.finalizing = false;
            this.set({ you: text });
            return;
        }
        const speechMs = this.lastSpeechFrame * FRAME_MS;
        const ptt = this.snapshot.mode === 'ptt';
        const echo = !ptt && this.bargePaused && this.looksLikeEcho(text);
        if (verdict === 'empty' || (!ptt && verdict === 'filler' && (this.bargePaused || speechMs < 900)) || echo) {
            this.note(echo ? 'dismiss-echo' : verdict === 'empty' ? 'dismiss-empty' : 'dismiss-filler', text);
            this.endUtterance();
            if (this.bargePaused) {
                this.bargePaused = false;
                this.resumePlayback();
            }
            else
                this.set({ phase: this.turnBusy ? 'thinking' : 'listening' });
            return;
        }
        this.endUtterance();
        this.timing = { at: Date.now(), speechEnd, asrMs: Date.now() - asrAsked };
        if (this.bargePaused || this.turnBusy || this.pendingSegs.size) {
            this.bargePaused = false;
            this.interruptReply();
            this.note('barge-commit', text);
        }
        else
            this.note('utterance', text);
        void this.submit(text);
    }
    endUtterance() {
        this.send({ t: 'u_drop', u: this.utteranceId });
        this.inUtterance = false;
        this.finalizing = false;
        this.speechRun = 0;
        this.silenceRun = 0;
        this.speculative = undefined;
        this.judgedIncomplete = false;
        announce('listening', false);
    }
    dropUtterance() {
        this.endUtterance();
        if (this.bargePaused) {
            this.bargePaused = false;
            this.resumePlayback();
        }
    }
    looksLikeEcho(text) {
        const norm = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
        const heard = norm(text);
        if (heard.length < 2)
            return false;
        const said = norm(this.recentSpoken.join(''));
        if (said.includes(heard))
            return true;
        let hits = 0;
        for (let i = 0; i + 2 <= heard.length; i++)
            if (said.includes(heard.slice(i, i + 2)))
                hits++;
        return heard.length >= 4 && hits / (heard.length - 1) > 0.7;
    }
    /* ---------- 想 + 说 ---------- */
    async submit(text) {
        this.turnAbort?.abort();
        const abort = new AbortController();
        this.turnAbort = abort;
        this.turnBusy = true;
        this.dotLine = '';
        this.recentSpoken = [];
        const timing = this.timing;
        if (timing) {
            timing.submit = Date.now();
            timing.text = text;
            this.timings.push(timing);
            if (this.timings.length > 50)
                this.timings.shift();
        }
        this.set({ phase: 'thinking', you: text, dot: '' });
        const segmenter = new Segmenter(piece => { if (!abort.signal.aborted)
            this.speak(piece); });
        let gotText = false;
        try {
            this.lastActive = Date.now();
            await this.turn(`${this.snapshot.mode === 'ptt' ? '〔语音〕' : '〔电话〕'}${text}`, {
                signal: abort.signal,
                onDelta: delta => {
                    if (abort.signal.aborted)
                        return;
                    if (!gotText && timing)
                        timing.firstText = Date.now();
                    gotText = true;
                    this.dotLine += delta;
                    this.set({ dot: speakable(this.dotLine).slice(-160) });
                    segmenter.push(delta);
                },
                onFinal: () => { if (!abort.signal.aborted)
                    segmenter.finish(); },
            });
            if (!abort.signal.aborted)
                segmenter.finish();
        }
        catch (cause) {
            if (!abort.signal.aborted)
                this.set({ notice: `DOT 这边出错了：${cause?.message ?? cause}` });
        }
        finally {
            if (this.turnAbort === abort) {
                this.turnBusy = false;
                this.turnAbort = undefined;
            }
            if (!abort.signal.aborted && !gotText)
                this.set({ notice: 'DOT 这轮没有文字回复' });
            this.settlePhase();
        }
    }
    speak(text) {
        const s = ++this.segSeq;
        this.segText.set(s, text);
        this.pendingSegs.add(s);
        this.recentSpoken.push(text);
        if (this.recentSpoken.length > 6)
            this.recentSpoken.shift();
        this.send({ t: 'say', s, text, voice: this.snapshot.voice });
    }
    interruptReply() {
        this.turnAbort?.abort();
        this.turnAbort = undefined;
        this.turnBusy = false;
        this.send({ t: 'hush' });
        this.stopPlayback();
    }
    onServer(msg) {
        if (msg.t === 'asr') {
            const waiter = this.asrWaiters.get(msg.r);
            if (waiter) {
                this.asrWaiters.delete(msg.r);
                waiter({ ok: msg.ok, text: msg.text ?? '', error: msg.error });
            }
            return;
        }
        if (msg.t === 'say_end') {
            if (!msg.ok && msg.error && this.pendingSegs.has(msg.s))
                this.set({ notice: `念不出来：${msg.error}` });
            const until = Math.max(0, (this.nextPlayAt - (this.playCtx?.currentTime ?? 0)) * 1000);
            const s = msg.s;
            setTimeout(() => { this.pendingSegs.delete(s); this.segText.delete(s); this.settlePhase(); }, until + 60);
        }
    }
    onAudio(data) {
        const view = new DataView(data);
        if (view.getUint8(0) !== 1 || !this.playCtx)
            return;
        const s = view.getUint32(1);
        if (!this.pendingSegs.has(s))
            return;
        const samples = (data.byteLength - 5) >> 1;
        if (!samples)
            return;
        const buffer = this.playCtx.createBuffer(1, samples, TTS_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++)
            channel[i] = view.getInt16(5 + i * 2, true) / 0x8000;
        const node = this.playCtx.createBufferSource();
        node.buffer = buffer;
        node.connect(this.playCtx.destination);
        const now = this.playCtx.currentTime;
        const startAt = Math.max(this.nextPlayAt, now + (this.nextPlayAt < now ? 0.12 : 0.02));
        node.start(startAt);
        this.nextPlayAt = startAt + buffer.duration;
        this.sources.add(node);
        node.onended = () => { this.sources.delete(node); this.settlePhase(); };
        if (this.timing && !this.timing.firstAudio) {
            this.timing.firstAudio = Date.now() + Math.round((startAt - now) * 1000);
            this.set({ lastLatencyMs: this.timing.firstAudio - this.timing.speechEnd });
        }
        if (!this.inUtterance && this.snapshot.phase !== 'speaking') {
            announce('speaking', true);
            this.set({ phase: 'speaking' });
        }
    }
    isPlaying() { return !!this.playCtx && this.playCtx.state === 'running' && this.nextPlayAt > this.playCtx.currentTime + 0.01; }
    pausePlayback() { void this.playCtx?.suspend(); }
    resumePlayback() { void this.playCtx?.resume(); this.settlePhase(); }
    stopPlayback() {
        for (const node of this.sources) {
            try {
                node.stop();
            }
            catch { /* 已停 */ }
        }
        this.sources.clear();
        this.pendingSegs.clear();
        this.segText.clear();
        this.nextPlayAt = 0;
        void this.playCtx?.resume();
        announce('speaking', false);
    }
    settlePhase() {
        if (!this.active || this.inUtterance)
            return;
        if (this.isPlaying() || this.sources.size) {
            if (this.snapshot.phase !== 'speaking')
                this.set({ phase: 'speaking' });
            return;
        }
        announce('speaking', false);
        if (this.turnBusy || this.pendingSegs.size) {
            if (this.snapshot.phase !== 'thinking')
                this.set({ phase: 'thinking' });
            return;
        }
        if (this.snapshot.phase !== 'listening')
            this.set({ phase: 'listening' });
    }
    /* ---------- 安卓壳事件 ---------- */
    onNativeEvent(detail) {
        const event = (detail ?? {});
        switch (event.type) {
            case 'hangup':
                this.hangup('已在手机上挂断');
                break;
            case 'mute':
                if (!this.snapshot.muted)
                    this.toggleMute();
                break;
            case 'unmute':
                if (this.snapshot.muted)
                    this.toggleMute();
                break;
            case 'start':
                void this.start();
                break;
            case 'interrupted': // 来电 / 其他 App 抢了音频焦点
                if (this.inUtterance)
                    this.dropUtterance();
                this.interruptReply();
                if (!this.snapshot.muted)
                    this.toggleMute();
                this.set({ notice: '手机这边被打断了，已自动静音' });
                break;
            case 'route':
                this.set({ route: event.route });
                break;
        }
    }
    fail(message) {
        this.wantOpen = false;
        this.teardown();
        this.set({ phase: 'error', error: message });
        notifyNative('call.end', { error: message });
    }
    teardown() {
        clearInterval(this.pingTimer);
        this.turnAbort?.abort();
        this.turnAbort = undefined;
        this.turnBusy = false;
        if (this.inUtterance)
            this.endUtterance();
        this.stopPlayback();
        const ws = this.ws;
        this.ws = undefined;
        try {
            ws?.close();
        }
        catch { /* 已断 */ }
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = undefined;
        this.worklet?.disconnect();
        this.worklet = undefined;
        void this.micCtx?.close();
        this.micCtx = undefined;
        void this.playCtx?.close();
        this.playCtx = undefined;
        for (const [, resolve] of this.asrWaiters)
            resolve({ ok: false, text: '' });
        this.asrWaiters.clear();
        this.level = 0;
        announce('listening', false);
        announce('speaking', false);
    }
    set(patch) {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const listener of this.listeners)
            listener();
        if (patch.phase)
            notifyNative('call.state', { phase: patch.phase });
    }
}
function defaultWsUrl() {
    const url = window.DOT_VOICE_WS_URL;
    if (!url)
        throw new Error('未配置语音服务地址，请先接入兼容服务');
    return url;
}
/* 精灵姿态：听到用户说话→“在听”，DOT 念话→“回复中”。由 index.ts 注入实际实现。 */
let announcer = () => { };
export function setCallAnnouncer(fn) { announcer = fn; }
function announce(kind, on) { try {
    announcer(kind, on);
}
catch { /* 姿态只是装饰 */ } }
