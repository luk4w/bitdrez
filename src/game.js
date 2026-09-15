/**
    @Autor Lucas Franco de Mello
    @Description Implementação de um jogo de xadrez com bitboards em JavaScript
    @Date 2024-06-27
*/

// Importação das constantes
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, PIECES_SAN } from './constants/pieces.js';
import { WHITE, BLACK } from './constants/colors.js';

import { CAPTURE_SOUND, CASTLING_SOUND, CHECK_SOUND, END_SOUND, FAILURE_SOUND, MOVE_SOUND } from './constants/sounds.js';
import { RANK_1, RANK_8 } from './constants/masks.js';

import {
    WHITE_ROOK_KINGSIDE, WHITE_ROOK_QUEENSIDE, BLACK_ROOK_KINGSIDE, BLACK_ROOK_QUEENSIDE
} from './constants/castling.js';

import Renderer from "./renderer.js";
import Notation from "./notation.js";
import Board from "./board.js";

class Game {
    isImportingGame; // Verifica se o PGN foi importado
    isEngineTurn; // Verifica se o Stockfish está jogando
    playAgainstStockfish; // Jogar contra o Stockfish
    board; // Tabuleiro
    wasmSupported; // Supote a WebAssembly
    stockfish; // Stockfish
    renderer; // HTML
    isPromotion;

    constructor() {
        this.isImportingGame = false;
        this.isEngineTurn = true;
        this.playAgainstStockfish = true;
        this.initStockfish();
        this.board = new Board();
        this.renderer = new Renderer(this);
        this.renderer.renderBoard(this.board);
        this.isPromotion = false;
    }

    initStockfish() {
        this.wasmSupported = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
        this.stockfish = new Worker(this.wasmSupported ? './stockfish/stockfish.wasm.js' : './stockfish/stockfish.js');
        // this.stockfish = new Worker(this.wasmSupported ? 'https://luk4w.github.io/bitdrez/stockfish/stockfish.wasm.js' : 'https://luk4w.github.io/bitdrez/stockfish/stockfish.js');
        
        // Adiciona o listener ao stockfish
        this.stockfish.addEventListener('message', (e) => {
            if (e.data.startsWith('bestmove')) {
                this.isEngineTurn = true;
                const bestMove = e.data.split(' ')[1];
                setTimeout(() => {
                    // Executa o melhor movimento do Stockfish
                    this.executeStockfishMove(bestMove, this.board);
                    // Atualiza as variáveis para o próximo movimento
                    this.board.fromPosition = null;
                    this.board.selectedColor = null;
                    this.board.toPosition = null;
                    this.board.availableMoves = 0n;
                    // Atualiza o tabuleiro
                    this.renderer.renderBoard(this.board);
                }, 500);
                this.isEngineTurn = false;
            }
        })
    }

    executeStockfishMove(bestMove, board) {
        board.selectedPiece = Notation.getPieceFromFEN(board.fen, bestMove);
        board.selectedColor = board.turn;
        // Caso uma promoção
        if (bestMove.length === 5) {
            switch (bestMove.charAt(4)) {
                case 'q':
                    board.promotionPiece = QUEEN;
                    break;
                case 'r':
                    board.promotionPiece = ROOK;
                    break;
                case 'b':
                    board.promotionPiece = BISHOP;
                    break;
                case 'n':
                    board.promotionPiece = KNIGHT;
                    break;
            }
            // Remove o caractere de promoção
            bestMove = bestMove.substring(0, 4);
        }
        this.testMove(bestMove, board);
    }

    // Move a peça
    movePiece(board) {
        // Cor da peça adversária
        const OPPONENT_COLOR = board.selectedColor === WHITE ? BLACK : WHITE;
        // Bitboards das peças adversárias
        const OPPONENT_PIECES = board.bitboards[OPPONENT_COLOR][PAWN] | board.bitboards[OPPONENT_COLOR][KNIGHT] | board.bitboards[OPPONENT_COLOR][BISHOP]
            | board.bitboards[OPPONENT_COLOR][ROOK] | board.bitboards[OPPONENT_COLOR][QUEEN] | board.bitboards[OPPONENT_COLOR][KING];
        // Mascara de bits da nova posição
        const TO_MASK = 1n << BigInt(board.toPosition);
        // Verificar se algum som ja foi tocado
        let isPlayedSound = false;
        // Verificar se houve captura de peça
        let isCapture = false;
        // Verifica se o movimento é válido
        if (board.availableMoves & TO_MASK) {
            // Incrementa os meios movimentos
            board.halfMoves++;
            // Remove a posição de origem da peça
            board.bitboards[board.selectedColor][board.selectedPiece] &= ~(1n << BigInt(board.fromPosition));
            // Adiciona a nova posição da peça
            board.bitboards[board.selectedColor][board.selectedPiece] |= TO_MASK;

            // Peças específicas
            switch (board.selectedPiece) {
                case PAWN:
                    // Verifica se o peão chegou ao final do tabuleiro
                    if (TO_MASK & RANK_8 || TO_MASK & RANK_1) {
                        this.promotionPawn(board);
                        return;
                    }
                    // Obtem os peões adversários
                    const OPPONENT_PAWNS = board.selectedColor === WHITE ? board.bitboards[BLACK][PAWN] : board.bitboards[WHITE][PAWN];
                    // Casa de destino da captura en passant: logo atrás do peão marcado
                    const EN_PASSANT_SQUARE = board.selectedColor === WHITE ? board.enPassant + 8 : board.enPassant - 8;
                    // Verifica se o peão foi capturado pelo movimento en passant
                    if ((board.enPassant !== null) && (board.toPosition === EN_PASSANT_SQUARE)
                        && (OPPONENT_PAWNS & (1n << BigInt(board.enPassant)))) {
                        // remove o peão capturado
                        board.bitboards[OPPONENT_COLOR][PAWN] &= ~(1n << BigInt(board.enPassant));
                        isPlayedSound = true;
                        isCapture = true;
                    }
                    // Verifica se o peão avançou duas casas em seu primeiro movimento
                    if (Math.abs(board.fromPosition - board.toPosition) === 16) {
                        // Verifica se existe um peão adversário do lado esquerdo ou direito
                        // Na coluna h (índice % 8 = 0) não existe casa à direita, na coluna a (índice % 8 = 7) não existe à esquerda
                        if ((OPPONENT_PAWNS & (1n << BigInt(board.toPosition - 1)) && board.toPosition % 8 !== 0) ||
                            (OPPONENT_PAWNS & (1n << BigInt(board.toPosition + 1)) && board.toPosition % 8 !== 7)) {
                            // marca o própio peão para ser capturado pelo movimento en passant
                            board.enPassant = board.toPosition;
                        } else {
                            // Desmarca o peão que pode ser capturado en passant
                            board.enPassant = null;
                        }
                    } else {
                        board.enPassant = null;
                    }
                    board.halfMoves = 0;
                    break;
                case KING:
                    // verifica se o movimento foi um roque
                    if (Math.abs(board.fromPosition - board.toPosition) === 2) {
                        // Efeito sonoro de roque
                        this.playSound(CASTLING_SOUND);
                        isPlayedSound = true;
                        // Adicionar torre na posição do roque curto
                        if (board.toPosition === board.fromPosition - 2) {
                            // Roque do lado do rei
                            board.bitboards[board.selectedColor][ROOK] &= ~(1n << BigInt(board.fromPosition - 3));
                            board.bitboards[board.selectedColor][ROOK] |= 1n << BigInt(board.fromPosition - 1);
                        }
                        // Adicionar torre na posição do roque longo
                        else if (board.toPosition === board.fromPosition + 2) {
                            // Roque do lado da rainha
                            board.bitboards[board.selectedColor][ROOK] &= ~(1n << BigInt(board.fromPosition + 4));
                            board.bitboards[board.selectedColor][ROOK] |= 1n << BigInt(board.fromPosition + 1);
                        }
                    }
                    if (board.selectedColor === WHITE) {
                        board.availableCastlingMask &= ~(WHITE_ROOK_KINGSIDE | WHITE_ROOK_QUEENSIDE); // Remove KQ
                    } else {
                        board.availableCastlingMask &= ~(BLACK_ROOK_KINGSIDE | BLACK_ROOK_QUEENSIDE); // Remove kq
                    }
                    break;
                case ROOK:
                    if (1n << BigInt(board.fromPosition) & board.availableCastlingMask) {
                        switch (1n << BigInt(board.fromPosition)) {
                            case WHITE_ROOK_QUEENSIDE:
                                board.availableCastlingMask &= ~WHITE_ROOK_QUEENSIDE; // Remove Q
                                break;
                            case WHITE_ROOK_KINGSIDE:
                                board.availableCastlingMask &= ~WHITE_ROOK_KINGSIDE; // Remove K
                                break;
                            case BLACK_ROOK_QUEENSIDE:
                                board.availableCastlingMask &= ~BLACK_ROOK_QUEENSIDE; // Remove q
                                break;
                            case BLACK_ROOK_KINGSIDE:
                                board.availableCastlingMask &= ~BLACK_ROOK_KINGSIDE; // Remove k
                                break;
                        }
                    }
                    break;
            }
            // O en passant só vale no lance seguinte ao avanço duplo
            if (board.selectedPiece !== PAWN) board.enPassant = null;

            // Verifica se houve captura de peça
            if (TO_MASK & OPPONENT_PIECES) {
                // Iteração nas bitboards adversárias, para saber qual peça foi capturada
                for (let opponentPiece = 0; opponentPiece < 6; opponentPiece++) {
                    if (board.bitboards[OPPONENT_COLOR][opponentPiece] & TO_MASK) {
                        // Remove a peça adversária
                        board.bitboards[OPPONENT_COLOR][opponentPiece] &= ~TO_MASK;
                        // Verifica se a peça capturada foi uma torre
                        if (opponentPiece === ROOK && board.availableCastlingMask !== 0n) {
                            switch (TO_MASK) {
                                case WHITE_ROOK_QUEENSIDE:
                                    board.availableCastlingMask &= ~WHITE_ROOK_QUEENSIDE; // Remove Q
                                    break;
                                case WHITE_ROOK_KINGSIDE:
                                    board.availableCastlingMask &= ~WHITE_ROOK_KINGSIDE; // Remove K
                                    break;
                                case BLACK_ROOK_QUEENSIDE:
                                    board.availableCastlingMask &= ~BLACK_ROOK_QUEENSIDE; // Remove q
                                    break;
                                case BLACK_ROOK_KINGSIDE:
                                    board.availableCastlingMask &= ~BLACK_ROOK_KINGSIDE; // Remove k
                                    break;
                            }
                        }
                    }
                }
                isPlayedSound = true;
                isCapture = true;
                board.enPassant = null;
                board.halfMoves = 0;
            }
            // Verifica se o rei adversário está em xeque
            let opponentKingCheck = board.isKingInCheck(board.bitboards, OPPONENT_COLOR);
            if (opponentKingCheck) {
                board.kingCheckMask = opponentKingCheck; // Marca o rei adversário
                // verifica se o rei adversário está em xeque mate
                if (board.getDefenderMovesMask(OPPONENT_COLOR) === 0n) {
                    board.isMate = true;
                    this.playSound(END_SOUND);
                    this.renderer.showCheckmate(board);
                }
                else {
                    // Efeito sonoro de xeque
                    this.playSound(CHECK_SOUND);
                    isPlayedSound = true;
                }
            }
            // Verifica o empate por afoboardnto
            else if (board.getMovesMask(OPPONENT_COLOR, board.bitboards, board.enPassant) === 0n) {
                this.playSound(END_SOUND);
                this.renderer.showDraw(board);
            }
            else {
                // Desmarca o rei em xeque
                board.kingCheckMask = 0n;
            }
            if (isCapture) {
                // Efeito sonoro de captura
                this.playSound(CAPTURE_SOUND);
            }
            else if (!isPlayedSound) {
                // Efeito sonoro de movimento
                this.playSound(MOVE_SOUND);
            }
            // Contagem das jogadas completas
            if (board.turn === BLACK) {
                board.fullMoves++;
            }
            // Atualiza o turno
            board.turn = board.turn === WHITE ? BLACK : WHITE;
            if (!this.isImportingGame) {
                // Atualiza a FEN no layout
                this.renderer.updateFEN(board);
                // Registra o movimento em notação algébrica
                const isCheck = board.kingCheckMask !== 0n;
                board.metadata.moves.push(Notation.getSanMove(board.fromPosition, board.toPosition, board.selectedPiece, isCapture, null, isCheck, board.isMate));
                // Atualiza o PGN no layout
                this.renderer.updatePGN(board);

                if (this.isEngineTurn && this.playAgainstStockfish) {
                    // Mostrar o tabuleiro no console
                    this.stockfish.postMessage('position fen ' + board.fen);
                    // Solicitar o melhor movimento com profundidade 2
                    this.stockfish.postMessage('go depth 12');
                } else if (!this.isEngineTurn && this.playAgainstStockfish) {
                    this.isEngineTurn = true;
                }
            }
            // Verificar se houve empate por repetições ....

            // Atualizar o ultimo movimento
            board.lastMoveMask = 1n << BigInt(board.fromPosition) | 1n << BigInt(board.toPosition);
        } else {
            // Efeito sonoro de movimento inválido
            this.playSound(FAILURE_SOUND);
            board.invalidMove = Notation.getSanMove(board.fromPosition, board.toPosition, board.selectedPiece, false, null, false, false);
        }
    }

    playSound(file) {
        if (!this.isImportingGame) {
            file.play();
        }
    }

    promotionPawn(board) {
        // Informa que está ocorrendo uma promoção de peão
        this.isPromotion = true;
        const TO_MASK = 1n << BigInt(board.toPosition);
        const FROM_MASK = 1n << BigInt(board.fromPosition);
        const color = board.selectedColor;
        // Variáveis de controle
        let opponentPiece = null;
        let isCapture = false;
        // Função para promover o peão
        const promote = (board) => {
            // Remove o peão
            board.bitboards[color][PAWN] &= ~TO_MASK; // LINHA 340 DO ERRO AQUI <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
            // Adiciona a peça promovida
            board.bitboards[color][board.promotionPiece] |= TO_MASK;
            // A promoção também encerra o en passant do lance anterior
            board.enPassant = null;
            // Cor da peça adversária e bitboards das peças adversárias
            const OPPONENT_COLOR = color === WHITE ? BLACK : WHITE;
            const OPPONENT_PIECES = board.bitboards[OPPONENT_COLOR][PAWN]
                | board.bitboards[OPPONENT_COLOR][KNIGHT]
                | board.bitboards[OPPONENT_COLOR][BISHOP]
                | board.bitboards[OPPONENT_COLOR][ROOK]
                | board.bitboards[OPPONENT_COLOR][QUEEN]
                | board.bitboards[OPPONENT_COLOR][KING];
            // Verifica se houve captura de peça
            if (TO_MASK & OPPONENT_PIECES) {
                isCapture = true;
                for (let op = 0; op < 6; op++) {
                    if (board.bitboards[OPPONENT_COLOR][op] & TO_MASK) {
                        opponentPiece = op;
                        board.bitboards[OPPONENT_COLOR][op] &= ~TO_MASK;
                    }
                }
            }
            // Verifica se o rei adversário está em xeque
            const opponentKingCheck = board.isKingInCheck(board.bitboards, OPPONENT_COLOR);
            if (opponentKingCheck) {
                board.kingCheckMask = opponentKingCheck;
                // Verifica se o rei adversário está em xeque-mate
                if (board.getDefenderMovesMask(OPPONENT_COLOR) === 0n) {
                    board.isMate = true;
                    this.renderer.showCheckmate(board);
                } else {
                    // Efeito sonoro de xeque
                    this.playSound(CHECK_SOUND);
                }
            } else if (board.getMovesMask(OPPONENT_COLOR, board.bitboards, board.enPassant) === 0n) {
                this.renderer.showDraw(board);
            } else {
                board.kingCheckMask = 0n;
            }
            // Efeito sonoro de captura ou movimento
            this.playSound(isCapture ? CAPTURE_SOUND : MOVE_SOUND);
            // Contagem das jogadas completas e atualização do turno
            if (board.turn === BLACK) board.fullMoves++;
            board.turn = board.turn === WHITE ? BLACK : WHITE;
            // Atualiza a FEN e PGN no layout
            this.renderer.updateFEN(board);
            // Se não estiver ocorrendo uma importação de jogo
            if (!this.isImportingGame) {
                const isCheck = board.kingCheckMask !== 0n;
                board.metadata.moves.push(Notation.getSanMove(board.fromPosition, board.toPosition, board.selectedPiece, isCapture, board.promotionPiece, isCheck, board.isMate));
                // Atualiza as notações FEN e PGN no layout
                this.renderer.updateFEN(board);
                this.renderer.updatePGN(board);
                // Verifica se é a vez do Stockfish jogar
                if (this.isEngineTurn && this.playAgainstStockfish) {
                    this.stockfish.postMessage('position fen ' + board.fen);
                    this.stockfish.postMessage('go depth 12');
                } else if (!this.isEngineTurn && this.playAgainstStockfish) {
                    this.isEngineTurn = true;
                }
            }
        };

        if (board.promotionPiece !== null && board.promotionPiece !== undefined) {
            promote(board);
            board.lastMoveMask = FROM_MASK | TO_MASK;
            board.fromPosition = null;
            board.selectedColor = null;
            board.toPosition = null;
            board.availableMoves = 0n;
            board.selectedPiece = null;
            board.promotionPiece = null;
            // Atualiza o tabuleiro com a peça promovida
            this.isPromotion = false;
            this.renderer.renderBoard(board);
            return;
        }

        // Escolha da peça no tabuleiro
        this.renderer.showPromotion(board, (piece) => {
            if (piece !== null) {
                board.promotionPiece = piece;
                promote(board);
                board.lastMoveMask = FROM_MASK | TO_MASK;
            } else {
                // Restaura o peão se a promoção for cancelada
                board.bitboards[color][PAWN] |= FROM_MASK;
                board.bitboards[color][PAWN] &= ~TO_MASK;
                board.halfMoves--;
            }
            board.fromPosition = null;
            board.selectedColor = null;
            board.toPosition = null;
            board.availableMoves = 0n;
            board.selectedPiece = null;
            board.promotionPiece = null;

            // Atualiza o tabuleiro com a peça promovida
            this.isPromotion = false;
            this.renderer.renderBoard(board);
        });
    }

    // Função para selecionar e mover a peça
    onMove(board, position) {
        if (this.isPromotion) return;
        // Verifica se a peça ainda não foi selecionada
        if (board.fromPosition === null) {
            for (let color = 0; color < 2; color++) {
                for (let piece = 0; piece < 6; piece++) {
                    if (board.bitboards[color][piece] & (1n << BigInt(position))) {
                        // Verifica se a peça pertence ao jogador do turno atual
                        if (color !== board.turn) {
                            return;
                        }
                        // Obtem o tipo da peça, a cor e a posição de origem
                        board.selectedPiece = piece;
                        board.selectedColor = color;
                        board.fromPosition = position;
                        // Redefine a máscara de movimentos disponíveis
                        board.availableMoves = 0n;
                        // Obtem os movimentos disponíveis
                        board.getAvailableMoves();
                    }
                }
            }
        } else {
            // Obtem a posição de destino
            board.toPosition = position;
            // Obtem as peças do jogador atual
            const OWN_PIECES = board.bitboards[board.turn][PAWN] | board.bitboards[board.turn][KNIGHT] | board.bitboards[board.turn][BISHOP]
                | board.bitboards[board.turn][ROOK] | board.bitboards[board.turn][QUEEN] | board.bitboards[board.turn][KING];
            // Verifica se a peça de origem é da mesma cor que a de destino
            if (OWN_PIECES & (1n << BigInt(board.toPosition))) {
                board.fromPosition = null;
                board.selectedColor = null;
                board.availableMoves = 0n;
                // Refaz a seleção da peça
                this.onMove(board, board.toPosition);
                return;
            } else {
                // Verifica se o movimento não é ilegal
                if (!board.isIllegalMove()) {
                    // Movimenta a peça
                    this.movePiece(board);
                }
                else {
                    // Efeito sonoro de movimento inválido
                    this.playSound(FAILURE_SOUND);
                }
            }
            // Atualiza as variáveis para o próximo movimento, se não estiver ocorrendo uma promoção de peão
            if (!this.isPromotion) {
                board.fromPosition = null;
                board.selectedColor = null;
                board.toPosition = null;
                board.availableMoves = 0n;
            }
        }
        // Se não estiver ocorrendo uma promoção de peão
        if (!this.isPromotion) {
            this.renderer.renderBoard(board); // Renderiza o tabuleiro
        }
    }

    restart(board) {
        board.init();
        this.renderer.reset(board);
        this.renderer.updateFEN(board);
        this.renderer.updatePGN(board);

    }

    testMove(sanMove, board) {
        // Remover caracteres de captura, promoção, xeque, xeque-mate e siglas para as peças
        const formattedMove = sanMove.replace(/[NBRQKx+#=]/g, ""); // exf4=ef4; e3xf4=e3f4; e4
        const FILES = "hgfedcba";
        const RANKS = "12345678";
        let fromFile = null;
        let fromRank = null;
        let toFile = null;
        let toRank = null;

        // Verifica se é promoção
        if (sanMove.includes("=")) {
            // A peça vem logo após o "=" (o lance pode terminar com + ou #)
            const promotionMatch = sanMove.match(/=([NBRQ])/i);
            if (!promotionMatch) {
                board.invalidMove = sanMove;
                return;
            }
            board.promotionPiece = PIECES_SAN.indexOf(promotionMatch[1].toUpperCase());
        }
        // Roque curto ou longo
        if (formattedMove === "O-O" || formattedMove === "O-O-O") {
            if (board.turn === WHITE) {
                board.fromPosition = 3;
                board.toPosition = formattedMove === "O-O" ? 1 : 5;
            } else {
                board.fromPosition = 59;
                board.toPosition = formattedMove === "O-O" ? 57 : 61;
            }
        }
        // Movimentos completos
        else if (formattedMove.length === 4) {
            // e2e4 f7f5 d2d4
            fromFile = formattedMove.charAt(0);
            fromRank = formattedMove.charAt(1);
            toFile = formattedMove.charAt(2);
            toRank = formattedMove.charAt(3);
            board.fromPosition = FILES.indexOf(fromFile) + RANKS.indexOf(fromRank) * 8;
            board.toPosition = FILES.indexOf(toFile) + RANKS.indexOf(toRank) * 8;
        }
        // Movimentos simplificados
        else if (formattedMove.length === 2) {
            // e4 f1 d8
            toFile = formattedMove.charAt(0);
            toRank = formattedMove.charAt(1);
            // Posição de destino
            board.toPosition = FILES.indexOf(toFile) + RANKS.indexOf(toRank) * 8;
            // Obter a posição de origem da peça
            let bitboard = board.bitboards[board.turn][board.selectedPiece];
            // percorrer o bitboard da peça selecionada
            for (let i = 0; i < 64; i++) {
                if (bitboard & (1n << BigInt(i))) {
                    // Obter os movimentos possíveis da peça
                    let moveMask = board.getPieceMovesMask(i, board.selectedPiece, board.turn, board.bitboards, board.enPassant);
                    if (moveMask & 1n << BigInt(board.toPosition)) {
                        board.fromPosition = i;
                        break;
                    }
                }
            }
        }
        // Simplificados com designação de coluna ou linha
        else if (formattedMove.length === 3) {
            // ef4 bd7 1e2 fe8
            toFile = formattedMove.charAt(1);
            toRank = formattedMove.charAt(2);
            // Obter a linha ou coluna da peça
            let fromRank = null;
            let fromFile = null;
            if (/[1-8]/.test(formattedMove.charAt(0))) fromRank = formattedMove.charAt(0);
            else if (/[a-h]/.test(formattedMove.charAt(0))) fromFile = formattedMove.charAt(0);
            board.toPosition = FILES.indexOf(toFile) + RANKS.indexOf(toRank) * 8;
            // Bitboard da peça selecionada
            let bitboard = board.bitboards[board.turn][board.selectedPiece];
            // Percorrer apenas a coluna ou linha do bitboard da peça selecionada
            for (let i = 0; i < 64; i++) {
                if (bitboard & (1n << BigInt(i))) {
                    const isOrigin = (fromRank && RANKS[Math.floor(i / 8)] === fromRank) || (fromFile && FILES[i % 8] === fromFile);
                    // A peça precisa alcançar o destino (ex.: gxf6 com peões em g2 e g5)
                    const moveMask = board.getPieceMovesMask(i, board.selectedPiece, board.turn, board.bitboards, board.enPassant);
                    if (isOrigin && moveMask & (1n << BigInt(board.toPosition))) {
                        board.fromPosition = i;
                        break;
                    }
                }
            }
        }
        if (board.fromPosition === null || board.toPosition === null || board.fromPosition < 0 || board.toPosition < 0
            || board.fromPosition === undefined || board.toPosition === undefined) {
            board.invalidMove = sanMove;
        } else {
            board.getAvailableMoves();
            this.movePiece(board);
        }
    }

    importPGN(pgn) {
        this.isImportingGame = true;
        // Função para limpar e obter o valor dos metadados
        function getMetadataValue(metadata) {
            const match = metadata.match(/"(.*)"/);
            return match ? match[1] : "";
        }
        const tempBoard = new Board();
        // Obter a sequência de movimentos
        let pgnMoves = pgn.replace(/\[.*?\]/g, '').replace(/\d+\./g, '').replace(/\s+/g, ' ').trim().split(' ');
        // Verifica se está vazio ou se os movimentos são iguais aos movimentos atuais
        if (pgnMoves.length === 0 || (pgnMoves.length === 1 && pgnMoves[0] === "")) {
            this.renderer.showImportPGNError(null, null);
            return;
        }
        // Inserir a lista de movimentos no jogo temporário
        tempBoard.metadata.moves = pgnMoves;
        // Obter os metadados
        let metadata = pgn.match(/\[.*?\]/g);
        if (metadata) {
            metadata.forEach(data => {
                let value = getMetadataValue(data);
                if (data.includes("[Event ")) tempBoard.metadata.event = value;
                else if (data.includes("[Site ")) tempBoard.metadata.site = value;
                else if (data.includes("[Date ")) tempBoard.metadata.date = value;
                else if (data.includes("[Round ")) tempBoard.metadata.round = value;
                else if (data.includes("[White ")) tempBoard.metadata.white = value;
                else if (data.includes("[Black ")) tempBoard.metadata.black = value;
                else if (data.includes("[Result ")) tempBoard.metadata.result = value;
            });
        }
        let count = 0;
        // Percorrer todos os movimentos
        for (let move of pgnMoves) {
            // Verificar se o movimento está formatado corretamente
            if (!move.match(/^([a-h][1-8])?[a-h][1-8](=[NBRQK])?[+#]?$/i) && // Peões
                !move.match(/^[a-h][1-8]?(x[a-h][1-8])(=[NBRQK])?[+#]?$/i) && // Captura com peão
                !move.match(/^[NBRQK]([a-h][1-8])?x?[a-h][1-8][+#]?$/i) && // Peças maiores com capturas
                !move.match(/^[NBRQK][a-h]?[1-8]?x?[a-h][1-8][+#]?$/i) && // Peças maiores movimento simplificado
                !move.match(/^O-O(-O)?$/) && // Roques
                !move.match(/^1-0$/) && // Brancas vencem
                !move.match(/^0-1$/) && // Pretas vencem
                !move.match(/^1\/2-1\/2$/)) // Empate
            {
                // Exibir mensagem de erro
                this.renderer.showImportPGNError(move, tempBoard);
                return;
            } else {
                // Ocultar a mensagem de erro
                this.renderer.hideImportPGNError();
            }
            // Resultado da partida
            if (move === "1-0" || move === "0-1" || move === "1/2-1/2") {
                tempBoard.metadata.result = move;
                continue;
            }
            // Obter a primeira letra do movimento
            const firstChar = move.charAt(0);
            // Selecionar o turno
            tempBoard.selectedColor = tempBoard.turn;
            // Verificar qual peça está se movendo
            if (firstChar === firstChar.toLowerCase()) {
                // exf4 e3xf4 (não pode capturar na mesma coluna)
                if (move.includes('x') && (move.charAt(0) === move.charAt(2) || move.charAt(0) === move.charAt(2))) {
                    this.renderer.showImportPGNError(move, tempBoard);
                    return;
                }
                tempBoard.selectedPiece = PAWN;

            } else {
                // Selecionar a peça
                switch (firstChar) {
                    case PIECES_SAN[KNIGHT]:
                        tempBoard.selectedPiece = KNIGHT;
                        break;
                    case PIECES_SAN[BISHOP]:
                        tempBoard.selectedPiece = BISHOP;
                        break;
                    case PIECES_SAN[ROOK]:
                        tempBoard.selectedPiece = ROOK;
                        break;
                    case PIECES_SAN[QUEEN]:
                        tempBoard.selectedPiece = QUEEN;
                        break;
                    case PIECES_SAN[KING]:
                    case "O":
                        tempBoard.selectedPiece = KING;
                        break;
                    default:
                        this.renderer.showImportPGNError(move, tempBoard);
                        return;
                }
            }
            this.testMove(move, tempBoard);
            if (tempBoard.invalidMove) {
                this.renderer.showImportPGNError(move, tempBoard);
                return;
            }
            count++;
        }
        // Atualizar o estado do jogo
        tempBoard.availableMoves = 0n;
        tempBoard.fromPosition = null;
        this.board = tempBoard;
        this.isImportingGame = false;
        this.renderer.renderBoard(this.board);
        this.renderer.updateFEN(this.board);
        this.renderer.updatePGN(this.board);
    }

    importFEN(fen, game) {
        // Verifica se a FEN contempla todas as partes
        if (fen.split(' ').length !== 6) {
            this.renderer.showError('Invalid FEN length');
            return;
        }
        // Dicionário de peças
        const PIECES = { 'p': PAWN, 'n': KNIGHT, 'b': BISHOP, 'r': ROOK, 'q': QUEEN, 'k': KING };
        // Divide a FEN em suas respectivas partes
        const [position, turn, castling, enPassant, halfMoves, fullMoves] = fen.split(' ');
        // Verifica se a FEN possui dois reis adversários
        let whiteKing = 0;
        let blackKing = 0;
        for (const rank of position.split('/')) {
            // Valida a formatação da FEN
            if (!rank.match(/^[1-8KQRBNPkqrbnp]+$/)) {
                this.renderer.showError('Invalid FEN format');
                return;
            }
            whiteKing += (rank.match(/K/g) || []).length;
            blackKing += (rank.match(/k/g) || []).length;
        }
        if (whiteKing !== 1 || blackKing !== 1) {
            this.renderer.showError('Invalid FEN kings');
            return;
        }
        // Limpa o tabuleiro
        game.bitboards = [
            new Array(6).fill(0n),
            new Array(6).fill(0n)
        ];
        // Atualiza o turno
        game.turn = turn === 'w' ? WHITE : BLACK;
        game.halfMoves = parseInt(halfMoves, 10);
        game.fullMoves = parseInt(fullMoves, 10);
        // Roque
        game.availableCastlingMask = 0n;
        if (castling !== '-') {
            for (const char of castling) {
                switch (char) {
                    case 'K':
                        game.availableCastlingMask |= WHITE_ROOK_KINGSIDE;
                        break;
                    case 'Q':
                        game.availableCastlingMask |= WHITE_ROOK_QUEENSIDE;
                        break;
                    case 'k':
                        game.availableCastlingMask |= BLACK_ROOK_KINGSIDE;
                        break;
                    case 'q':
                        game.availableCastlingMask |= BLACK_ROOK_QUEENSIDE;
                        break;
                    default:
                        throw new Error('Invalid Castling');
                }
            }
        }
        // En passant
        if (enPassant !== '-') {
            // Casa de captura en passant no índice do bitboard; o peão capturável fica uma fileira antes dela
            let enPassantCapture = "hgfedcba".indexOf(enPassant.charAt(0)) + (parseInt(enPassant.charAt(1), 10) - 1) * 8;
            game.enPassant = game.turn === WHITE ? enPassantCapture - 8 : enPassantCapture + 8;
        } else {
            game.enPassant = null;
        }

        // Obtem os dados das linhas do tabuleiro no formato FEN
        const ranks = position.split('/'); // [rnbqkbnr,pppppppp,8,8,8,8,PPPPPPPP,RNBQKBNR]
        // Percorre as linhas do tabuleiro
        for (let i = 0; i < 8; i++) {
            // Linha do tabuleiro em formato FEN
            let rank = ranks[i];
            // Indice da coluna
            let j = 0;
            // Percorre as peças de cada linha
            for (let char of rank) {
                // Verifica se é um número
                if (/\d/.test(char)) {
                    j += parseInt(char, 10);
                } else {
                    // Obtem a peça
                    let piece = PIECES[char.toLowerCase()];
                    // Obtem a cor da peça
                    let color = char === char.toLowerCase() ? BLACK : WHITE;
                    // Adiciona a peça no bitboard
                    game.bitboards[color][piece] |= 1n << BigInt((7 - i) * 8 + (7 - j));
                    j++;
                }
            }
        }
        game.metadata.fen = fen;
        game.fen = fen;
        game.kingCheckMask = game.isKingInCheck(game.bitboards, game.turn);
        game.lastMoveMask = 0n;
        game.availableMoves = 0n;
        game.metadata.moves = [];
        this.renderer.updatePGN(game);
    }
}
export default Game;