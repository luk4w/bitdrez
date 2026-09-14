/**
    Renderização do tabuleiro em caracteres (canvas), baseada no Charachess.
    O estado do jogo vem dos bitboards; aqui apenas se anima o que mudou entre um render e outro.
*/
// Importação das constantes
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './constants/pieces.js';
import { WHITE } from './constants/colors.js';
import Notation from "./notation.js";

let FONT_SIZE = 0;                // calculada para o tabuleiro caber no espaço disponível
const LIGHT_ALPHA = 0.65;         // letras das casas claras
const DARK_ALPHA = 0.2;           // letras das casas escuras
const HOLE_FRACTION = 0.6;        // fração do tabuleiro que as peças arrancam no início
const PAD = 1.05;                 // pad em volta da peça, em alturas de linha
const SQUEEZE_SCALE = 0.6;        // tamanho da letra quando espremida
const SQUEEZE_SPEED = 10;
const SHADE = '@#%&$*+=~-:.';      // miolo das peças, do lado da luz para o da sombra
const BOARD_COL_STEP = 2;         // uma letra do tabuleiro a cada N colunas (maior = menos denso)
const BURST_TIME = 0.7;           // segundos que as letras da peça capturada levam para estourar e sumir
const BURST_SPEED = 35;           // velocidade máxima do estouro, em alturas de linha por segundo
const BURST_DRAG = 4.5;           // freio do estouro (maior = fica mais perto da casa)
const NO_LETTER = 255;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789{}[]()<>/\\|=+-*:;.,~^_#$%&';
const COLORS = ['#00e5ff', '#ff2bd6', '#c9d6f2', '#ffffff', '#ffe14d']; // brancas (neon ciano), pretas (neon magenta), tabuleiro (branco-azulado neon), flash da captura, último lance (amarelo)
const GLOW = [0.7, 0.7, 0.12, 0, 0.5];
const CHECK_COLOR = '#ff2a2a';
const BOARD_ROW = 2;
const FLASH_ROW = 3;
const LAST_MOVE_ROW = 4;
const SPRING = 70;
const DAMP = 9;
const CORNER_LEN = 0.22;          // tamanho de cada canto da seleção, em fração do lado da casa
const TINT_RADIUS = 0.72;         // raio do brilho dos lances disponíveis, em alturas da casa
const TINT_ALPHA = 1.6;           // força do brilho (acima de 1 = letras cheias até mais longe do centro)
const LAST_MOVE_RADIUS = 0.85;    // raio da marca do último lance, em alturas da casa
const LAST_MOVE_ALPHA = 1.5;      // força da marca do último lance no destino (a origem fica com metade)
const IMPACT_DELAY = 0.25;        // segundos entre o lance e a peça capturada explodir (atacante chegando)
const FLASH_TIME = 0.1;           // segundos em que os estilhaços ficam brancos logo após o impacto
const SHAKE_TIME = 0.3;           // duração do tremor da tela no impacto
const SHAKE_AMP = 0.35;           // força do tremor, em alturas de linha

// Arte ASCII de cada peça (edite à vontade). Todas centradas na mesma coluna;
// cada caractere que não é espaço vira um caractere da peça.
const ART = Object.fromEntries(Object.entries({
    P: String.raw`
    _
   ( )
   ) (
  /   \
 (_____)`,
    R: String.raw`
 [_]_[_]
  |   |
  |   |
 /_____\
(_______)`,
    N: String.raw`
   /\/\
  / @  }
 (_,-. }
    /  }
   |___}
 /_____\
(_______)`,
    B: String.raw`
    o
   / \
  ( / )
   \_/
   | |
 /_____\
(_______)`,
    Q: String.raw`
 o. o .o
  \/^\/
   \_/
   | |
  /   \
 /_____\
(_______)`,
    K: String.raw`
   _|_
  .-'-.
 (  |  )
  \___/
   | |
  /   \
 /_____\
(_______)`,
}).map(([t, s]) => [t, s.split('\n').filter(line => line.trim())]));
const ART_W = Math.max(...Object.values(ART).flat().map(line => line.trimEnd().length));
const ART_H = Math.max(...Object.values(ART).map(lines => lines.length));
// Letra da arte de cada peça, na ordem das constantes (PAWN = 0 ... KING = 5)
const TYPE_ART = [];
TYPE_ART[PAWN] = 'P'; TYPE_ART[KNIGHT] = 'N'; TYPE_ART[BISHOP] = 'B';
TYPE_ART[ROOK] = 'R'; TYPE_ART[QUEEN] = 'Q'; TYPE_ART[KING] = 'K';

const canvas = document.getElementById('board-canvas');
const container = canvas.parentElement;
const ctx = canvas.getContext('2d');
const boardCanvas = document.createElement('canvas');   // letras paradas do tabuleiro
const boardCtx = boardCanvas.getContext('2d');
const squeezeCanvas = document.createElement('canvas'); // letras espremidas que já pararam
const squeezeCtx = squeezeCanvas.getContext('2d');

const CHARS = [...new Set(LETTERS + SHADE + Object.values(ART).flat().join('').replace(/ /g, ''))];
const charIdx = Object.fromEntries(CHARS.map((c, i) => [c, i]));
const randomChar = () => charIdx[LETTERS[(Math.random() * LETTERS.length) | 0]];
const monoFont = size => `${size}px ui-monospace, Consolas, monospace`;
// '#rrggbb' -> 'rgba(r, g, b, a)'
const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

await document.fonts.ready;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
// A grade em caracteres é fixa; o resize só muda o tamanho em pixels de cada célula.
ctx.font = monoFont(100);
const CELL_RATIO = ctx.measureText('M').width / 120;   // largura / altura da célula
const SQ_R = ART_H + 2;                                 // casa = SQ_C x SQ_R caracteres
const SQ_C = Math.max(ART_W + 6, Math.round(SQ_R / CELL_RATIO));
const bCols = 8 * SQ_C, bRows = 8 * SQ_R;

let W = 0, H = 0, DPR = 1;
let CW = 0, CH = 0;
let boardX = 0, boardY = 0, boardW = 0, boardH = 0;
let boardChar, hidden, pool, atlas;
let dispX, dispY, dispTX, dispTY, jitX, jitY;
let cellMode;          // 0 parada no lugar (boardCanvas), 1 se mexendo (desenhada a cada frame), 2 espremida e parada (squeezeCanvas)
let activeCells = [];  // células no modo 1
let squeezeDirty = false;
let particles = [];
let boardFull = true;
const dirty = [];      // células cuja letra parada mudou desde o último frame
const impacts = [];    // capturas esperando o atacante chegar
let shake = 0;

// Peças desenhadas: view[r][f], r = 0 é a 8ª fileira e f = 0 é a coluna a
let view = [];

// Estado vindo do jogo, usado no desenho
let selected = null, selFrom = null, selTime = 0, hover = null;
let availableSquares = [], lastMoveSquares = [], checkSquares = [];
let moveColor = WHITE;
let promotion = null;  // { color, choices: [{ type, f, r }], onChoose }
const marks = new Set(); // casas marcadas com o botão direito (índice do bitboard)
let game = null;

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Índice do bitboard (0 = h1, 63 = a8) <-> casa na tela
const toSquare = index => ({ f: 7 - index % 8, r: 7 - Math.floor(index / 8) });
const toIndex = (f, r) => (7 - r) * 8 + (7 - f);

function maskSquares(mask) {
    const squares = [];
    if (!mask) return squares;
    for (let i = 0; i < 64; i++) {
        if (mask & (1n << BigInt(i))) squares.push(toSquare(i));
    }
    return squares;
}

function cellAlpha(col, row) {
    return (Math.floor(col / SQ_C) + Math.floor(row / SQ_R)) % 2 === 0 ? LIGHT_ALPHA : DARK_ALPHA;
}

// a letra da célula apareceu/sumiu: atualiza a camada onde ela está desenhada
function cellChanged(c) {
    if (cellMode[c] === 0) dirty.push(c);
    else if (cellMode[c] === 2) squeezeDirty = true;
}

// Atlas: todos os CHARS em cada cor, pré-renderizados (no loop só drawImage).
// Tem margem em volta de cada glifo para caber o brilho neon.
function makeAtlas(size) {
    const font = monoFont(size);
    const pad = Math.ceil(size * 0.6);
    ctx.font = font;
    const cw = Math.ceil(ctx.measureText('M').width) + 2 * pad;
    const ch = Math.ceil(size * 1.2) + 2 * pad;
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = CHARS.length * cw * DPR;
    atlasCanvas.height = COLORS.length * ch * DPR;
    const a = atlasCanvas.getContext('2d');
    a.scale(DPR, DPR);
    a.font = font;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    COLORS.forEach((color, row) => {
        a.fillStyle = color;
        a.shadowColor = color;
        a.shadowBlur = size * GLOW[row];
        // peças desenhadas 3x por cima: neon mais aceso
        for (let pass = row < 2 ? 3 : 1; pass > 0; pass--) {
            CHARS.forEach((c, i) => a.fillText(c, i * cw + cw / 2, row * ch + ch / 2));
        }
    });
    return { canvas: atlasCanvas, cw, ch };
}

// desenha o glifo centrado em (cx, cy)
function drawGlyph(g, ci, colorRow, cx, cy, scale = 1) {
    const w = atlas.cw * scale, h = atlas.ch * scale;
    g.drawImage(atlas.canvas, ci * atlas.cw * DPR, colorRow * atlas.ch * DPR, atlas.cw * DPR, atlas.ch * DPR,
        cx - w / 2, cy - h / 2, w, h);
}

// Máscara da peça: cada caractere da arte, centrado na casa e apoiado na base dela.
// Pontas de cada fileira são o contorno; o meio (espaços e '_') vira miolo sombreado,
// com a luz batendo a 20% da esquerda.
function buildMask(lines) {
    const top = SQ_R - 1 - lines.length, left = Math.floor((SQ_C - ART_W) / 2);
    const mask = [];
    lines.forEach((line, row) => {
        const lo = line.search(/\S/), hi = line.trimEnd().length - 1;
        for (let col = lo; col <= hi; col++) {
            const fill = col > lo && col < hi && (line[col] === ' ' || line[col] === '_');
            const d = Math.min(1, Math.abs((col - lo) / (hi - lo || 1) - 0.2) / 0.8);
            mask.push({
                col: left + col, row: top + row,
                ch: charIdx[fill ? SHADE[Math.min(SHADE.length - 1, Math.floor(d * SHADE.length))] : line[col]],
                alpha: fill ? 1 - 0.5 * d : 1,
            });
        }
    });
    return mask;
}

// Para cada letra da casa: quanto ela é empurrada quando essa peça está lá (em células).
// Letras a menos de PAD da peça vão para a célula mais próxima fora do pad.
function buildSqueeze(mask) {
    const n = SQ_C * SQ_R;
    const inside = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
        const col = k % SQ_C, row = (k / SQ_C) | 0;
        inside[k] = mask.some(m => Math.hypot((col - m.col) * CELL_RATIO, row - m.row) < PAD) ? 1 : 0;
    }
    const dx = new Float32Array(n), dy = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        if (!inside[k]) continue;
        const col = k % SQ_C, row = (k / SQ_C) | 0;
        let best = Infinity;
        for (let j = 0; j < n; j++) {
            if (inside[j]) continue;
            const oc = j % SQ_C - col, or = ((j / SQ_C) | 0) - row;
            const d = (oc * CELL_RATIO) ** 2 + or * or;
            if (d < best) { best = d; dx[k] = oc; dy[k] = or; }
        }
    }
    return { dx, dy };
}

const masks = TYPE_ART.map(t => buildMask(ART[t]));
const squeezeMaps = masks.map(buildSqueeze);
// Caracteres das 32 peças da posição inicial: define quantas letras cada caractere de peça junta
const START_CHARS = 2 * (8 * masks[PAWN].length + 2 * (masks[KNIGHT].length + masks[BISHOP].length + masks[ROOK].length)
    + masks[QUEEN].length + masks[KING].length);
let share = 1;

const cellX = col => boardX + (col + 0.5) * CW;
const cellY = row => boardY + (row + 0.5) * CH;

// Só geometria: recalcula a escala e reposiciona o que já existe, sem reiniciar animações.
function resize() {
    const oldX = boardX, oldY = boardY, oldCW = CW, oldCH = CH;
    W = Math.round(container.clientWidth);
    H = Math.round(container.clientHeight);
    if (!W || !H) return;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    // maior fonte (até 32px) em que o tabuleiro cabe; sem mínimo, para caber em tela pequena
    FONT_SIZE = Math.min(32,Math.min(W * 0.96 / (bCols * CELL_RATIO), H * 0.96 / bRows) / 1.2);
    CH = FONT_SIZE * 1.2;
    CW = CH * CELL_RATIO;
    // fonte miúda no celular: aproveita a densidade de pixels da tela para as letras não borrarem
    DPR = Math.min(FONT_SIZE < 8 ? 3 : 2, window.devicePixelRatio || 1);
    canvas.width = boardCanvas.width = squeezeCanvas.width = Math.round(W * DPR);
    canvas.height = boardCanvas.height = squeezeCanvas.height = Math.round(H * DPR);
    boardW = bCols * CW;
    boardH = bRows * CH;
    boardX = Math.round((W - boardW) / 2);
    boardY = Math.round((H - boardH) / 2);
    atlas = makeAtlas(FONT_SIZE);

    for (const p of particles) {
        if (oldCW) {
            const sx = CW / oldCW, sy = CH / oldCH;
            p.x = boardX + (p.x - oldX) * sx;
            p.y = boardY + (p.y - oldY) * sy;
            p.vx *= sx;
            p.vy *= sy;
        }
        p.hx = cellX(p.hcol);
        p.hy = cellY(p.hrow);
        p.tx = cellX(p.tcol);
        p.ty = cellY(p.trow);
        if (p.settled || !oldCW) { p.x = p.settled ? p.tx : p.hx; p.y = p.settled ? p.ty : p.hy; }
    }
    boardFull = true;
    squeezeDirty = true;
}

// Peças que devem estar no tabuleiro, lidas dos bitboards
function readBitboards(board) {
    const target = Array.from({ length: 8 }, () => new Array(8).fill(null));
    for (let color = 0; color < 2; color++) {
        for (let type = 0; type < 6; type++) {
            const bitboard = board.bitboards[color][type];
            if (!bitboard) continue;
            for (let i = 0; i < 64; i++) {
                if (!(bitboard & (1n << BigInt(i)))) continue;
                const { f, r } = toSquare(i);
                // Durante a promoção o peão divide a casa com a peça capturada: fica a peça de quem jogou
                if (target[r][f] && color !== board.turn) continue;
                target[r][f] = { color, type };
            }
        }
    }
    return target;
}

// Monta o tabuleiro do zero: letras novas e as peças arrancando letras
function init(board) {
    const n = bCols * bRows;
    boardChar = new Uint8Array(n).map((_, c) => (c % bCols) % BOARD_COL_STEP === 0 ? randomChar() : NO_LETTER);
    hidden = new Uint8Array(n);    // letra arrancada por uma peça
    pool = shuffle([...Array(n).keys()].filter(c => boardChar[c] !== NO_LETTER));
    // deslocamentos das letras espremidas, em células
    dispX = new Float32Array(n);
    dispY = new Float32Array(n);
    dispTX = new Float32Array(n);
    dispTY = new Float32Array(n);
    jitX = new Float32Array(n).map(() => (Math.random() - 0.5) * 0.8);
    jitY = new Float32Array(n).map(() => (Math.random() - 0.5) * 0.5);
    cellMode = new Uint8Array(n);
    activeCells = [];
    dirty.length = 0;
    impacts.length = 0;
    squeezeDirty = true;
    share = Math.max(1, Math.floor(pool.length * HOLE_FRACTION / START_CHARS));

    particles = [];
    view = readBitboards(board).map((line, r) => line.map((want, f) => {
        if (!want) return null;
        const piece = { ...want, particles: [] };
        recruit(piece, f, r);
        squeeze(f, r, piece.type);
        return piece;
    }));
    boardFull = true;
}

// ---------------------------------------------------------------------------
// Sincronização com os bitboards
// ---------------------------------------------------------------------------
// Compara as peças desenhadas com os bitboards e anima a diferença:
// mesma peça em outra casa voa até lá (inclui a torre do roque), peão que virou outra peça
// se transforma (promoção), peça que sumiu estoura (captura, inclusive en passant)
// e peça sem origem se forma do tabuleiro (importação de FEN/PGN).
function sync(board) {
    const target = readBitboards(board);
    const removed = [], added = [];
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const piece = view[r][f], want = target[r][f];
            if (piece && want && piece.color === want.color && piece.type === want.type) continue;
            if (piece) {
                removed.push({ piece, f, r });
                view[r][f] = null;
                squeeze(f, r, null);
            }
            if (want) added.push({ ...want, f, r });
        }
    }
    if (!removed.length && !added.length) return;

    const lastMove = board.lastMoveMask || 0n;
    // tira da lista a peça que satisfaz o teste, preferindo a casa de origem do último lance e depois a mais próxima
    const take = (test, f, r) => {
        let best = -1, bestScore = Infinity;
        removed.forEach((it, i) => {
            if (!test(it.piece)) return;
            const fromLastMove = lastMove & (1n << BigInt(toIndex(it.f, it.r)));
            const score = Math.hypot(it.f - f, it.r - r) - (fromLastMove ? 100 : 0);
            if (score < bestScore) { bestScore = score; best = i; }
        });
        return best < 0 ? null : removed.splice(best, 1)[0].piece;
    };

    let moved = false;
    const pending = [];
    for (const a of added) {
        const piece = take(p => p.color === a.color && p.type === a.type, a.f, a.r);
        if (piece) { place(piece, a.f, a.r); moved = true; }
        else pending.push(a);
    }
    for (const a of pending) {
        const pawn = take(p => p.color === a.color && p.type === PAWN, a.f, a.r);
        if (pawn) {
            place(pawn, a.f, a.r);
            morph(pawn, a.type, a.f, a.r);
            moved = true;
        } else {
            const piece = { color: a.color, type: a.type, particles: [] };
            view[a.r][a.f] = piece;
            recruit(piece, a.f, a.r);
            squeeze(a.f, a.r, a.type);
        }
    }
    for (const it of removed) impacts.push({ victim: it.piece, t: moved ? IMPACT_DELAY : 0 });
}

function place(piece, f, r) {
    view[r][f] = piece;
    squeeze(f, r, piece.type);
    for (const p of piece.particles) {
        setTarget(p, f, r);
        p.settled = false;
        p.delay = Math.random() * 0.15;
    }
}

// Troca o tipo da peça reaproveitando as letras dela; as que sobram estouram
function morph(piece, type, f, r) {
    const old = piece.particles;
    piece.type = type;
    piece.particles = [];
    shuffle(old);
    recruit(piece, f, r, old);
    release(old);
    squeeze(f, r, type);
}

// ---------------------------------------------------------------------------
// Letras do tabuleiro espremidas pela peça
// ---------------------------------------------------------------------------
function squeeze(f, r, type) {
    const map = type === null ? null : squeezeMaps[type];
    for (let sr = 0; sr < SQ_R; sr++) {
        for (let sc = 0; sc < SQ_C; sc++) {
            const c = (r * SQ_R + sr) * bCols + f * SQ_C + sc, k = sr * SQ_C + sc;
            const moved = map && (map.dx[k] || map.dy[k]);
            const tx = moved ? map.dx[k] + jitX[c] : 0, ty = moved ? map.dy[k] + jitY[c] : 0;
            if (tx === dispTX[c] && ty === dispTY[c]) continue;
            dispTX[c] = tx;
            dispTY[c] = ty;
            if (cellMode[c] === 1) continue;
            if (cellMode[c] === 0) dirty.push(c);  // sai da camada do tabuleiro
            else squeezeDirty = true;              // sai da camada das espremidas
            cellMode[c] = 1;
            activeCells.push(c);
        }
    }
}

// Move as letras em direção ao alvo. Quando todas chegaram, cada uma vai para a
// camada certa e deixa de ser desenhada a cada frame.
function updateSqueeze(dt) {
    if (!activeCells.length) return;
    const k = 1 - Math.exp(-SQUEEZE_SPEED * dt);
    let settled = true;
    for (const c of activeCells) {
        dispX[c] += (dispTX[c] - dispX[c]) * k;
        dispY[c] += (dispTY[c] - dispY[c]) * k;
        if (Math.abs(dispTX[c] - dispX[c]) * CW + Math.abs(dispTY[c] - dispY[c]) * CH > 0.2) settled = false;
    }
    if (!settled) return;
    for (const c of activeCells) {
        dispX[c] = dispTX[c];
        dispY[c] = dispTY[c];
        if (dispX[c] === 0 && dispY[c] === 0) {
            cellMode[c] = 0;
            dirty.push(c);
        } else {
            cellMode[c] = 2;
        }
    }
    activeCells = [];
    squeezeDirty = true;
}

function drawSqueezed(g, c) {
    if (hidden[c] || boardChar[c] === NO_LETTER) return;
    const col = c % bCols, row = (c / bCols) | 0;
    const amount = Math.min(1, Math.hypot(dispX[c] * CW, dispY[c] * CH) / (CH * 2));
    g.globalAlpha = cellAlpha(col, row);
    drawGlyph(g, boardChar[c], BOARD_ROW, cellX(col + dispX[c]), cellY(row + dispY[c]),
        1 + (SQUEEZE_SCALE - 1) * amount);
}

function drawSqueezeLayer() {
    squeezeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    squeezeCtx.clearRect(0, 0, W, H);
    for (let c = 0; c < cellMode.length; c++) if (cellMode[c] === 2) drawSqueezed(squeezeCtx, c);
    squeezeCtx.globalAlpha = 1;
    squeezeDirty = false;
}

// ---------------------------------------------------------------------------
// Partículas
// ---------------------------------------------------------------------------
function takeCell() {
    while (pool.length) {
        const c = pool.pop();
        if (!hidden[c]) return c;
    }
    return -1;
}

function setTarget(p, f, r) {
    p.tcol = f * SQ_C + p.mc;
    p.trow = r * SQ_R + p.mr;
    p.tx = cellX(p.tcol);
    p.ty = cellY(p.trow);
}

// Cada caractere da peça junta `share` letras. `reuse`: partículas que já existem e podem virar parte da peça.
function recruit(piece, f, r, reuse = []) {
    const colorRow = piece.color === WHITE ? 0 : 1;
    for (const m of masks[piece.type]) {
        for (let j = 0; j < share; j++) {
            let p = reuse.pop();
            if (p) {
                p.ch = m.ch;
                p.alpha = m.alpha;
                p.mc = m.col;
                p.mr = m.row;
                p.lead = j === 0;
                p.piece = piece;
                p.settled = false;
                p.delay = Math.random() * 0.3;
            } else {
                p = {
                    x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0, hcol: 0, hrow: 0, home: -1, from: 0, lead: j === 0,
                    ch: m.ch, alpha: m.alpha, mc: m.col, mr: m.row, tx: 0, ty: 0, tcol: 0, trow: 0,
                    color: colorRow, piece, delay: Math.random() * 1.2, settled: false, burst: 0, flash: 0,
                };
                const home = takeCell();
                if (home >= 0) {
                    const col = home % bCols, row = (home / bCols) | 0;
                    hidden[home] = 1;
                    cellChanged(home);
                    p.home = home;
                    p.hcol = col;
                    p.hrow = row;
                    p.from = boardChar[home];
                } else {
                    // acabaram as letras do tabuleiro: vem de fora da tela
                    const ang = Math.random() * Math.PI * 2, R = Math.max(bCols * CW, bRows * CH);
                    p.hcol = (bCols + Math.cos(ang) * R / (CW || 1)) / 2;
                    p.hrow = (bRows + Math.sin(ang) * R / (CH || 1)) / 2;
                    p.from = randomChar();
                }
                p.hx = cellX(p.hcol);
                p.hy = cellY(p.hrow);
                p.x = p.hx;
                p.y = p.hy;
                particles.push(p);
            }
            setTarget(p, f, r);
            piece.particles.push(p);
        }
    }
}

// Letras que estouram ali mesmo e somem; os buracos que elas deixaram no tabuleiro ficam
function release(list) {
    for (const p of list) {
        const ang = Math.random() * Math.PI * 2, speed = CH * BURST_SPEED * (0.35 + 0.65 * Math.random());
        p.settled = false;
        p.delay = 0;
        p.vx = Math.cos(ang) * speed;
        p.vy = Math.sin(ang) * speed;
        p.burst = BURST_TIME * (0.6 + Math.random() * 0.4);
        p.flash = FLASH_TIME;
    }
}

function impact(im) {
    release(im.victim.particles);
    im.victim.particles = [];
    shake = SHAKE_TIME;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function pointerSquare(e) {
    const rect = canvas.getBoundingClientRect();
    const f = Math.floor((e.clientX - rect.left - boardX) / (SQ_C * CW));
    const r = Math.floor((e.clientY - rect.top - boardY) / (SQ_R * CH));
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? { f, r } : null;
}

canvas.addEventListener('pointermove', e => { hover = pointerSquare(e); });
canvas.addEventListener('pointerleave', () => { hover = null; });
canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const sq = pointerSquare(e);
    if (!sq || promotion) return;
    const index = toIndex(sq.f, sq.r);
    if (marks.has(index)) marks.delete(index);
    else marks.add(index);
});
canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !game) return;
    const sq = pointerSquare(e);
    if (promotion) {
        const choice = sq && promotion.choices.find(c => c.f === sq.f && c.r === sq.r);
        const { onChoose } = promotion;
        promotion = null;
        onChoose(choice ? choice.type : null);
        return;
    }
    marks.clear();
    if (!sq) return;
    game.onMove(game.board, toIndex(sq.f, sq.r));
});

new ResizeObserver(() => resize()).observe(container);

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
let last = performance.now();

function drawBoardCell(col, row) {
    const c = row * bCols + col;
    if (hidden[c] || cellMode[c] || boardChar[c] === NO_LETTER) return;
    boardCtx.globalAlpha = cellAlpha(col, row);
    drawGlyph(boardCtx, boardChar[c], BOARD_ROW, boardX + (col + 0.5) * CW, boardY + (row + 0.5) * CH);
}

function drawBoard() {
    boardCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    boardCtx.clearRect(0, 0, W, H);
    for (let row = 0; row < bRows; row++) {
        for (let col = 0; col < bCols; col++) drawBoardCell(col, row);
    }
    boardCtx.globalAlpha = 1;
    boardFull = false;
    dirty.length = 0;
}

// Redesenha só as células que mudaram. O glifo pode vazar 1px para o vizinho,
// então limpa e redesenha também a célula de cada lado.
function drawDirtyCells() {
    boardCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const c of dirty) {
        const col = c % bCols, row = (c / bCols) | 0;
        const c0 = Math.max(0, col - 1), c1 = Math.min(bCols - 1, col + 1);
        boardCtx.clearRect(boardX + c0 * CW, boardY + row * CH, (c1 - c0 + 1) * CW, CH);
        for (let k = c0; k <= c1; k++) drawBoardCell(k, row);
    }
    boardCtx.globalAlpha = 1;
    dirty.length = 0;
}

const squareRect = sq => [boardX + sq.f * SQ_C * CW, boardY + sq.r * SQ_R * CH, SQ_C * CW, SQ_R * CH];

// Quatro cantos em L em volta da casa. offset > 0 afasta os cantos para fora, < 0 puxa para dentro.
function squareCorners(g, sq, offset) {
    const x = boardX + sq.f * SQ_C * CW - offset, y = boardY + sq.r * SQ_R * CH - offset;
    const w = SQ_C * CW + 2 * offset, h = SQ_R * CH + 2 * offset;
    const len = Math.min(w, h) * CORNER_LEN;
    g.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
        g.moveTo(cx + sx * len, cy);
        g.lineTo(cx, cy);
        g.lineTo(cx, cy + sy * len);
    }
    g.stroke();
}

function neon(color) {
    ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = color;
    ctx.shadowBlur = FONT_SIZE * 0.6;
    ctx.lineWidth = Math.max(1.5, FONT_SIZE / 8);
    ctx.lineCap = 'round';
}

// Seleção: os cantos chegam de fora, encaixam na casa e ficam respirando, com brilho neon
function drawSelection(time) {
    const snap = (1 - Math.min(1, (time - selTime) * 5)) ** 3;
    ctx.save();
    ctx.globalAlpha = 1 - snap;
    neon(COLORS[selected.color === WHITE ? 0 : 1]);
    squareCorners(ctx, selFrom, -CH * 0.3 + snap * CH * 2.5 + Math.sin(time * 4) * CH * 0.12);
    ctx.restore();
}

// Casas marcadas, último lance, xeque e movimentos disponíveis
function drawHints(time) {
    ctx.save();
    // Último lance: as letras das duas casas ficam amarelas (cor própria, para não confundir com as peças), mais forte no destino
    const lastPiece = lastMoveSquares.map(sq => view[sq.r][sq.f]).find(Boolean);
    for (const sq of lastMoveSquares) {
        const isDestination = view[sq.r][sq.f] === lastPiece;
        drawTint(sq, LAST_MOVE_ROW, SQ_R * LAST_MOVE_RADIUS, LAST_MOVE_ALPHA * (isDestination ? 1 : 0.5), isDestination ? 0.2 : 0.1);
    }
    for (const index of marks) {
        ctx.fillStyle = 'rgba(255, 42, 42, .2)';
        ctx.fillRect(...squareRect(toSquare(index)));
    }
    for (const sq of checkSquares) {
        ctx.fillStyle = 'rgba(255, 42, 42, .14)';
        ctx.fillRect(...squareRect(sq));
        ctx.save();
        neon(CHECK_COLOR);
        ctx.globalAlpha = 0.65 + Math.sin(time * 6) * 0.35;
        squareCorners(ctx, sq, -CH * 0.3);
        ctx.restore();
    }
    const colorRow = moveColor === WHITE ? 0 : 1;
    // o brilho cresce do centro logo após selecionar a peça
    const grow = Math.min(1, (time - selTime) * 4);
    const radius = SQ_R * TINT_RADIUS * grow * (0.94 + Math.sin(time * 4) * 0.06);
    for (const sq of availableSquares) drawTint(sq, colorRow, radius, TINT_ALPHA, 0.22);
    neon(COLORS[colorRow]);
    ctx.globalAlpha = 0.6 + Math.sin(time * 5) * 0.25;
    for (const sq of availableSquares) {
        if (view[sq.r][sq.f]) squareCorners(ctx, sq, -CH * 1.2);
    }
    ctx.restore();
}

// As letras do meio da casa ganham a cor da peça, mais forte no centro.
// radius em linhas; strength acima de 1 deixa as letras cheias até mais longe do centro; haloAlpha 0 = sem halo.
function drawTint(sq, colorRow, radius, strength, haloAlpha) {
    if (radius <= 0) return;
    const cx = (SQ_C - 1) / 2, cy = (SQ_R - 1) / 2;
    ctx.shadowBlur = 0;
    if (haloAlpha > 0) {
        // halo suave por baixo das letras
        const [x, y, w, h] = squareRect(sq);
        const halo = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, radius * CH);
        halo.addColorStop(0, rgba(COLORS[colorRow], haloAlpha));
        halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = halo;
        ctx.fillRect(x, y, w, h);
    }
    for (let sr = 0; sr < SQ_R; sr++) {
        for (let sc = 0; sc < SQ_C; sc++) {
            const d = Math.hypot((sc - cx) * CELL_RATIO, sr - cy) / radius;
            if (d >= 1) continue;
            const col = sq.f * SQ_C + sc, row = sq.r * SQ_R + sr, c = row * bCols + col;
            if (hidden[c] || boardChar[c] === NO_LETTER) continue;
            const amount = Math.min(1, Math.hypot(dispX[c] * CW, dispY[c] * CH) / (CH * 2));
            ctx.globalAlpha = Math.min(1, (1 - d) * strength);
            drawGlyph(ctx, boardChar[c], colorRow, cellX(col + dispX[c]), cellY(row + dispY[c]),
                1 + (SQUEEZE_SCALE - 1) * amount);
        }
    }
}

// Escolha da promoção: tabuleiro escurecido e as quatro peças desenhadas com a arte ASCII
function drawPromotion() {
    const colorRow = promotion.color === WHITE ? 0 : 1;
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#000';
    ctx.fillRect(boardX, boardY, boardW, boardH);
    ctx.globalAlpha = 1;
    for (const c of promotion.choices) {
        ctx.fillStyle = '#000';
        ctx.fillRect(...squareRect(c));
        const lines = ART[TYPE_ART[c.type]];
        const top = c.r * SQ_R + SQ_R - 1 - lines.length, left = c.f * SQ_C + Math.floor((SQ_C - ART_W) / 2);
        lines.forEach((line, row) => {
            for (let col = 0; col < line.length; col++) {
                if (line[col] !== ' ') drawGlyph(ctx, charIdx[line[col]], colorRow, cellX(left + col), cellY(top + row));
            }
        });
        const isHover = hover && hover.f === c.f && hover.r === c.r;
        if (isHover) neon(COLORS[colorRow]);
        else {
            ctx.shadowBlur = 0;
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 255, 255, .35)';
        }
        squareCorners(ctx, c, -CH * 0.3);
    }
    ctx.restore();
}

function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    const damp = Math.exp(-DAMP * dt);

    for (let i = impacts.length - 1; i >= 0; i--) {
        if ((impacts[i].t -= dt) > 0) continue;
        impact(impacts[i]);
        impacts.splice(i, 1);
    }
    if (shake > 0) shake -= dt;

    updateSqueeze(dt);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.settled) continue;
        if (p.burst > 0) {
            // estouro da peça capturada: voa um pouco, freia e some (o buraco no tabuleiro fica)
            if (p.flash > 0) p.flash -= dt;
            const drag = Math.exp(-BURST_DRAG * dt);
            p.vx *= drag;
            p.vy *= drag;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.burst -= dt;
            if (p.burst > 0) continue;
            particles[i] = particles[particles.length - 1];
            particles.pop();
            continue;
        }
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.vx = (p.vx + (p.tx - p.x) * SPRING * dt) * damp;
        p.vy = (p.vy + (p.ty - p.y) * SPRING * dt) * damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if ((p.tx - p.x) ** 2 + (p.ty - p.y) ** 2 >= 0.25 || p.vx * p.vx + p.vy * p.vy >= 25) continue;
        // chegou na peça: sai da física até a peça se mover de novo
        p.x = p.tx;
        p.y = p.ty;
        p.vx = p.vy = 0;
        p.settled = true;
    }

    if (W && H) {
        if (boardFull || dirty.length > (bCols * bRows) / 4) drawBoard();
        else if (dirty.length) drawDirtyCells();
        if (squeezeDirty) drawSqueezeLayer();

        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (shake > 0) {
            const amp = SHAKE_AMP * CH * (shake / SHAKE_TIME) ** 2;
            ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
        }
        ctx.drawImage(boardCanvas, 0, 0, W, H);
        ctx.drawImage(squeezeCanvas, 0, 0, W, H);
        for (const c of activeCells) drawSqueezed(ctx, c);

        ctx.globalAlpha = 1;
        drawHints(time);
        ctx.lineWidth = 1;
        if (hover && !promotion && !(selected && hover.f === selFrom.f && hover.r === selFrom.r)) {
            ctx.strokeStyle = 'rgba(255, 255, 255, .35)';
            squareCorners(ctx, hover, -CH * 0.3);
        }
        if (selected) drawSelection(time);

        // letra do tabuleiro -> ganha a cor da peça -> as do grupo se fundem num caractere da peça
        const far = CH * 12;
        const bob = FONT_SIZE / 11;
        for (const p of particles) {
            if (p.burst > 0) {
                // pisca branco no impacto e vai sumindo enquanto estoura
                ctx.globalAlpha = Math.min(1, p.burst / BURST_TIME * 1.5);
                drawGlyph(ctx, p.from, p.flash > 0 ? FLASH_ROW : p.color, p.x, p.y);
                continue;
            }
            if (p.settled && !p.lead) continue; // fundida no caractere do lead: nem desenha
            const t = p.settled ? 1 : 1 - Math.min(1, Math.hypot(p.tx - p.x, p.ty - p.y) / far);
            if (t < 0.7) {
                // já arrancada: fica da cor da peça antes de sair voando
                ctx.globalAlpha = 1;
                drawGlyph(ctx, p.from, p.color, p.x, p.y);
            } else if (p.lead) {
                const y = p.piece === selected ? p.y + (-3 + Math.sin(time * 8 + p.mc * 0.7) * 1.2) * bob : p.y;
                ctx.globalAlpha = p.alpha;
                drawGlyph(ctx, p.ch, p.color, p.x, y);
            }
        }
        ctx.globalAlpha = 1;
        if (promotion) drawPromotion();
    }

    requestAnimationFrame(frame);
}

class Renderer {
    game;
    constructor(gameInstance) {
        this.game = game = gameInstance;
        const TEXTAREA = document.getElementById('pgn');
        const MOVES = document.getElementById('pgn-moves');
        const BUTTON = document.getElementById('import-pgn-button');
        const INPUT_FEN = document.getElementById('fen');
        this.pgnText = '';
        this.isEditingPGN = false;

        // Clique na lista de lances: abre o PGN em texto para colar e importar
        MOVES.addEventListener('click', () => {
            this.setEditingPGN(true);
            TEXTAREA.focus();
            TEXTAREA.setSelectionRange(TEXTAREA.value.length, TEXTAREA.value.length);
        });
        TEXTAREA.addEventListener('input', () => {
            this.hideImportPGNError();
        });
        TEXTAREA.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            this.setEditingPGN(false);
            TEXTAREA.blur();
        });
        TEXTAREA.addEventListener('blur', () => {
            setTimeout(() => {
                // Continua editando enquanto o erro de importação estiver na tela
                if (document.getElementById('import-error').style.visibility !== 'visible') this.setEditingPGN(false);
            }, 200);
        });
        BUTTON.addEventListener('click', () => {
            this.game.importPGN(TEXTAREA.value);
            if (document.getElementById('import-error').style.visibility !== 'visible') this.setEditingPGN(false);
        });

        // Enter confirma a FEN (o change dispara ao sair do campo)
        INPUT_FEN.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            INPUT_FEN.blur();
        });

        this.renderMoves([]);

        INPUT_FEN.addEventListener('change', () => {
            this.game.importFEN(INPUT_FEN.value, this.game.board);
            this.renderBoard(this.game.board);
        });

        // callback do botão restart
        document.getElementById("restart-button").addEventListener("click", () => {
            // Oculta a mensagem de fim de jogo
            document.getElementById("end").style.display = "none";
            // Reinicia o jogo
            this.game.restart(this.game.board);
        });

        resize();
        init(this.game.board);
        requestAnimationFrame(frame);
    }

    // Atualiza o tabuleiro a partir dos bitboards
    renderBoard(board) {
        // Apenas renderiza o tabuleiro se não estiver importando um jogo
        if (this.game.isImportingGame) return;
        sync(board);
        const hasSelection = board.fromPosition !== null && board.fromPosition !== undefined;
        const sq = hasSelection ? toSquare(board.fromPosition) : null;
        const piece = sq ? view[sq.r][sq.f] : null;
        if (piece !== selected) selTime = performance.now() / 1000;
        selected = piece;
        selFrom = piece ? sq : null;
        moveColor = board.selectedColor ?? board.turn;
        availableSquares = hasSelection ? maskSquares(board.availableMoves) : [];
        lastMoveSquares = maskSquares(board.lastMoveMask);
        checkSquares = maskSquares(board.kingCheckMask);

        // HUD: vez de quem joga e xeque
        const TURN = document.getElementById('hud-turn');
        TURN.textContent = board.turn === WHITE ? 'WHITE TO MOVE' : 'BLACK TO MOVE';
        TURN.className = `hud-turn ${board.turn === WHITE ? 'white' : 'black'}`;
        document.getElementById('hud-check').textContent = board.isMate ? 'CHECKMATE' : board.kingCheckMask ? 'CHECK' : '';
    }

    // Alterna entre a lista de lances e o PGN em texto
    setEditingPGN(on) {
        this.isEditingPGN = on;
        const TEXTAREA = document.getElementById('pgn');
        TEXTAREA.hidden = !on;
        document.getElementById('pgn-moves').hidden = on;
        document.getElementById('import-pgn-button').style.visibility = on ? 'visible' : 'hidden';
        if (!on) {
            TEXTAREA.value = this.pgnText;
            this.hideImportPGNError();
        }
    }

    // Lista de lances: número, lance das brancas e lance das pretas nas cores das peças
    renderMoves(moves) {
        const MOVES = document.getElementById('pgn-moves');
        MOVES.replaceChildren();
        for (let i = 0; i < moves.length; i += 2) {
            const row = document.createElement('li');
            const number = document.createElement('span');
            number.className = 'move-number';
            number.textContent = `${i / 2 + 1}.`;
            row.append(number);
            for (let j = i; j < i + 2 && j < moves.length; j++) {
                const move = document.createElement('span');
                move.className = `move ${j % 2 === 0 ? 'white' : 'black'}${j === moves.length - 1 ? ' last' : ''}`;
                move.textContent = moves[j];
                row.append(move);
            }
            MOVES.append(row);
        }
        if (!moves.length) {
            const empty = document.createElement('li');
            empty.className = 'pgn-empty';
            empty.textContent = 'no moves yet — click to paste a PGN';
            MOVES.append(empty);
        }
        MOVES.scrollTop = MOVES.scrollHeight;
    }

    // Recomeça o tabuleiro do zero (letras novas)
    reset(board) {
        marks.clear();
        promotion = null;
        init(board);
        this.renderBoard(board);
    }

    // Mostra as opções de promoção na coluna do peão e chama onChoose com a peça escolhida (null = cancelou)
    showPromotion(board, onChoose) {
        const to = toSquare(board.toPosition);
        const dir = to.r === 0 ? 1 : -1;
        selected = selFrom = null;
        availableSquares = [];
        sync(board); // o peão vai até a última fileira enquanto a escolha é feita
        promotion = {
            color: board.selectedColor,
            choices: [QUEEN, KNIGHT, ROOK, BISHOP].map((type, i) => ({ type, f: to.f, r: to.r + dir * i })),
            onChoose,
        };
    }

    updatePGN(board) {
        let pgn = Notation.generatePGN(board);
        // Obter apenas a sequência de movimentos
        this.pgnText = pgn.replace(/\[.*?\]/g, '').trim();
        this.renderMoves(board.metadata.moves);
        // Não sobrescreve o texto que está sendo editado
        if (!this.isEditingPGN) document.getElementById("pgn").value = this.pgnText;
        this.hideImportPGNError();
    }

    updateFEN(board) {
        board.fen = Notation.generateFEN(board);
        document.getElementById("fen").value = board.fen;
    }

    showImportPGNError(move, board) {
        const IMPORT_ERROR = document.getElementById("import-error");
        if (move === null) {
            IMPORT_ERROR.textContent = "PGN is empty";
        } else {
            const count = board.metadata.moves.indexOf(move);
            if (board.turn === WHITE) { // WHITE
                IMPORT_ERROR.textContent = `Invalid move: ${Math.floor(count / 2) + 1}. ${move}`;
            } else { // BLACK
                IMPORT_ERROR.textContent = `Invalid move: ${Math.floor(count / 2) + 1}. ... ${move}`;
            }
        }
        IMPORT_ERROR.style.visibility = "visible";
        this.game.isImportingGame = false;
    }

    showError(message) {
        const IMPORT_ERROR = document.getElementById("import-error");
        IMPORT_ERROR.textContent = message;
        IMPORT_ERROR.style.visibility = "visible";
        this.game.isImportingGame = false;
    }

    hideImportPGNError() {
        const IMPORT_ERROR = document.getElementById("import-error");
        IMPORT_ERROR.textContent = "";
        IMPORT_ERROR.style.visibility = "hidden";
    }

    showDraw(board) {
        // PGN
        board.metadata.result = "1/2-1/2";
        // Atualiza e exibe a mensagem de empate
        document.getElementById("end-game-message").textContent = "Draw!\nStalemate.";
        document.getElementById("end").style.display = "flex";
    }

    showCheckmate(board) {
        // PGN
        board.metadata.result = board.selectedColor === WHITE ? "1-0" : "0-1";
        // Indica o vencedor
        let winner = board.selectedColor === WHITE ? "White" : "Black";
        // Atualiza e exibe a mensagem de xeque mate
        document.getElementById("end-game-message").textContent = "Checkmate!\n" + winner + " wins.";
        document.getElementById("end").style.display = "flex";
    }
}
export default Renderer;
