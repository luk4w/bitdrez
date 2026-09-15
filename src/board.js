/**
    @Autor Lucas Franco de Mello
    @Description Implementação de um jogo de xadrez com bitboards em JavaScript
    @Date 2024-06-27
*/
// Importação das constantes
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, PIECES_STRING, PIECES_SAN } from './constants/pieces.js';
import { WHITE, BLACK } from './constants/colors.js';
import {
    WHITE_ROOK_KINGSIDE, WHITE_ROOK_QUEENSIDE, BLACK_ROOK_KINGSIDE, BLACK_ROOK_QUEENSIDE,
    WHITE_KINGSIDE_CASTLING_EMPTY, WHITE_QUEENSIDE_CASTLING_EMPTY, BLACK_KINGSIDE_CASTLING_EMPTY, BLACK_QUEENSIDE_CASTLING_EMPTY
} from './constants/castling.js';

// Importação das funções
import { getPawnMoves, getPawnAttackerMask } from './pawn.js';
import { getRookMoves, getR, getL, getU, getD } from './rook.js';
import { getKnightMoves } from './knight.js';
import { getBishopMoves, getUR, getUL, getLL, getLR } from './bishop.js';
import { getQueenMoves } from './queen.js';
import { getKingMoves } from './king.js';

class Board {
    // Tabuleiro da partida
    bitboards;
    availableMoves; // Movimentos disponíveis
    selectedPiece; // Peça selecionada
    selectedColor; // Cor selecionada
    fromPosition; // Posição de origem da peça
    toPosition; // Posição de destino da peça
    enPassant; // Posição do peão que pode ser capturado com en passant
    turn; // Turno atual
    fen; // FEN atual
    halfMoves; // Contagem de 100 movimentos sem captura ou movimento de peão (meio movimento)
    fullMoves; // Número total de movimentos completos
    kingCheckMask; // Máscara do rei em xeque
    availableCastlingMask // Máscara para os roques disponíveis
    promotionPiece; // Peça promovida
    isMate // Verificar se houve xeque mate
    metadata; // Metadados da partida
    invalidMove; // Registro do último movimento inválido
    lastMoveMask; // Mascara do ultimo movimento realizado (fromPosition e toPosition)

    init() {
        this.bitboards = [
            new Array(6).fill(0n), // Peças brancas
            new Array(6).fill(0n)  // Peças pretas
        ];
        // Inicializa o tabuleiro
        // Peões
        this.bitboards[BLACK][PAWN] = 0x00FF000000000000n;
        this.bitboards[WHITE][PAWN] = 0x000000000000FF00n;
        // Cavalos
        this.bitboards[BLACK][KNIGHT] = 0x4200000000000000n;
        this.bitboards[WHITE][KNIGHT] = 0x0000000000000042n;
        // Bispos
        this.bitboards[BLACK][BISHOP] = 0x2400000000000000n;
        this.bitboards[WHITE][BISHOP] = 0x0000000000000024n;
        // Torres
        this.bitboards[BLACK][ROOK] = 0x8100000000000000n;
        this.bitboards[WHITE][ROOK] = 0x0000000000000081n;
        // Rainhas
        this.bitboards[BLACK][QUEEN] = 0x1000000000000000n;
        this.bitboards[WHITE][QUEEN] = 0x0000000000000010n;
        // Reis
        this.bitboards[BLACK][KING] = 0x0800000000000000n;
        this.bitboards[WHITE][KING] = 0x0000000000000008n;
        // Reseta as variáveis da partida
        this.availableMoves = 0n;
        this.selectedPiece = null;
        this.selectedColor = null;
        this.fromPosition = null;
        this.toPosition = null;
        this.enPassant = null;
        this.turn = WHITE;
        this.fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        this.halfMoves = 0;
        this.fullMoves = 1;
        this.kingCheckMask = 0n;
        this.availableCastlingMask = WHITE_ROOK_KINGSIDE | WHITE_ROOK_QUEENSIDE | BLACK_ROOK_KINGSIDE | BLACK_ROOK_QUEENSIDE;
        // Metadados
        this.metadata = {
            event: "",
            site: "Chess Java Script",
            date: new Date().toLocaleDateString().replace(/\//g, "-"),
            round: "1",
            white: "Player 1",
            black: "Player 2",
            result: "*",
            moves: [],
            fen: ""
        };
        this.isMate = false;
        this.invalidMove = null;
        this.lastMoveMask = 0n;
    }

    constructor() {
        this.init();
    }

    getAvailableMoves() {
        // Obtem os movimentos possíveis da peça
        let moves = this.getPieceMovesMask(this.fromPosition, this.selectedPiece, this.selectedColor, this.bitboards, this.enPassant);
        // Verifica se o rei está em xeque
        if (this.isKingInCheck(this.bitboards, this.selectedColor)) {
            // movimentos possiveis para se defender do xeque
            let allDefenderMoves = this.getDefenderMovesMask(this.selectedColor);
            // A casa do en passant só defende o rei quando é um peão capturando o peão que dá xeque
            // (o próprio rei pode fugir para ela, se estiver livre)
            if (this.selectedPiece !== PAWN && this.selectedPiece !== KING && this.enPassant !== null) {
                const EN_PASSANT_SQUARE = this.selectedColor === WHITE ? this.enPassant + 8 : this.enPassant - 8;
                allDefenderMoves &= ~(1n << BigInt(EN_PASSANT_SQUARE));
            }
            // Verifica se a peça pode se mover para defender o rei
            if ((moves & allDefenderMoves) !== 0n) {
                this.availableMoves = (moves & allDefenderMoves);
            }
            return;
        }

        // Verifica se a peça está cravada
        const isPinned = this.isPinnedMask(this.fromPosition);
        // Verifica se a peça está cravada e pode se mover
        if (isPinned !== null && isPinned && this.selectedPiece !== KING) {
            this.availableMoves = isPinned;
            return;
        }
        // Verifica se a peça está cravada e não pode se mover
        else if (isPinned !== null && !isPinned && this.selectedPiece !== KING) {
            this.availableMoves = 0n;
            return;
        }
        this.availableMoves = moves;
        // Verifica se a mascara de roque está disponível
        if (this.availableCastlingMask !== 0n && this.selectedPiece === KING) {
            this.availableMoves |= this.getCastlingMovesMask(this.selectedColor);
        }
    }

    // Verificação do estado dos roques disponíveis
    getCastlingFEN(availableCastlingMask) {
        let result = '';
        if (availableCastlingMask & WHITE_ROOK_KINGSIDE) result += 'K';
        if (availableCastlingMask & WHITE_ROOK_QUEENSIDE) result += 'Q';
        if (availableCastlingMask & BLACK_ROOK_KINGSIDE) result += 'k';
        if (availableCastlingMask & BLACK_ROOK_QUEENSIDE) result += 'q';
        return result || '-';
    }

    /**
     * Obtem a máscara de bits de TODOS os movimentos possíveis
     * @param {Integer} color 
     * @param {Array<Array<BigInt>>} bitboards
     * @returns 
     */
    getMovesMask(color, bitboards, enPassant) {
        let allMoves = 0n;
        // Iteração das peças
        for (let piece = 0; piece < 6; piece++) {
            let bitboard = bitboards[color][piece];
            // Iteração das posições presentes em cada bitboard
            for (let i = 0; i < 64; i++) {
                // Verifica se existe uma peça na posição i
                if (bitboard & (1n << BigInt(i))) {
                    // Adiciona os movimentos possíveis da peça a todos os movimentos
                    allMoves |= this.getPieceMovesMask(i, piece, color, bitboards, enPassant);
                }
            }
        }
        return allMoves;
    }

    /**
     * Verifica se a peça está cravada
     * @param {Integer} fromPosition 
     * @returns null se a peça não está cravada, caso contrário retorna a mascara de bits dos movimentos possíveis	
     */
    isPinnedMask(fromPosition) {
        // Copia o estado atual das peças
        let tempBitboards = [
            this.bitboards[WHITE].map(bitboard => BigInt(bitboard)), // Copia o array de peças brancas
            this.bitboards[BLACK].map(bitboard => BigInt(bitboard))  // Copia o array de peças pretas
        ];
        const piece = this.selectedPiece;
        const color = this.selectedColor;
        // Mascara de bits do rei
        const KING_MASK = tempBitboards[color][KING];
        // Cor da peça adversária
        const OPPONENT_COLOR = color === WHITE ? BLACK : WHITE;
        // remove a peça aliada da posição de origem
        tempBitboards[color][piece] &= ~(1n << BigInt(fromPosition));
        // Mascara de bits do ataque (posição da peça e quadrados atacados)
        let attackerMask = 0n;
        // Contador de peças atacantes
        let count = 0;
        // Mascara de bits dos movimentos inimigos
        const ENEMY_MOVES = this.getMovesMask(OPPONENT_COLOR, tempBitboards, null);
        // verifica se o bitboard do rei coincide com algum bit de todos os movimentos de ataque das peças inimigas
        if (KING_MASK & ENEMY_MOVES) {
            // Obtem o attackMask
            for (let p = 0; p < 6; p++) {
                // Obtem o bitboard da peça
                let bitboard = tempBitboards[OPPONENT_COLOR][p];
                // Percorre as posições do bitboard
                for (let i = 0; i < 64; i++) {
                    // Verifica se existe uma peça na posição i
                    if (bitboard & (1n << BigInt(i))) {
                        // Escolhe o tipo da peça
                        switch (p) {
                            case ROOK:
                                // Verifica se a peça pode atacar o rei
                                if (getRookMoves(i, OPPONENT_COLOR, tempBitboards) & KING_MASK) {
                                    attackerMask |= 1n << BigInt(i);
                                    count++;
                                    // Obtem a direção do ataque
                                    // Ataca o rei na direita
                                    let rightMoves = getR(i, OPPONENT_COLOR, tempBitboards);
                                    if (rightMoves & KING_MASK) {
                                        attackerMask |= rightMoves;
                                        break;
                                    }
                                    // Ataca o rei na esquerda
                                    let leftMoves = getL(i, OPPONENT_COLOR, tempBitboards);
                                    if (leftMoves & KING_MASK) {
                                        attackerMask |= leftMoves;
                                        break;
                                    }
                                    // Ataca o rei para cima
                                    let upMoves = getU(i, OPPONENT_COLOR, tempBitboards);
                                    if (upMoves & KING_MASK) {
                                        attackerMask |= upMoves;
                                        break;
                                    }
                                    // Ataca o rei para baixo
                                    let downMoves = getD(i, OPPONENT_COLOR, tempBitboards);
                                    if (downMoves & KING_MASK) {
                                        attackerMask |= downMoves;
                                        break;
                                    }
                                }
                                break;
                            case BISHOP:
                                // Verifica se a peça pode atacar o rei
                                if (getBishopMoves(i, OPPONENT_COLOR, tempBitboards) & KING_MASK) {
                                    attackerMask |= 1n << BigInt(i);
                                    count++;
                                    // Obtem a direção do ataque
                                    // Ataca o rei na diagonal superior direita
                                    let upperRightMoves = getUR(i, OPPONENT_COLOR, tempBitboards);
                                    if (upperRightMoves & KING_MASK) {
                                        attackerMask |= upperRightMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal superior esquerda
                                    let upperLeftMoves = getUL(i, OPPONENT_COLOR, tempBitboards);
                                    if (upperLeftMoves & KING_MASK) {
                                        attackerMask |= upperLeftMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal inferior direita
                                    let lowerRightMoves = getLR(i, OPPONENT_COLOR, tempBitboards);
                                    if (lowerRightMoves & KING_MASK) {
                                        attackerMask |= lowerRightMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal inferior esquerda
                                    let lowerLeftMoves = getLL(i, OPPONENT_COLOR, tempBitboards);
                                    if (lowerLeftMoves & KING_MASK) {
                                        attackerMask |= lowerLeftMoves;
                                        break;
                                    }
                                }
                                break;
                            case QUEEN:
                                // Verifica se a peça pode atacar o rei
                                if (getQueenMoves(i, OPPONENT_COLOR, tempBitboards) & KING_MASK) {
                                    attackerMask |= 1n << BigInt(i);
                                    count++;
                                    // Obtem a direção do ataque
                                    // Ataca o rei na direita
                                    let rightMoves = getR(i, OPPONENT_COLOR, tempBitboards);
                                    if (rightMoves & KING_MASK) {
                                        attackerMask |= rightMoves;
                                        break;
                                    }
                                    // Ataca o rei na esquerda
                                    let leftMoves = getL(i, OPPONENT_COLOR, tempBitboards);
                                    if (leftMoves & KING_MASK) {
                                        attackerMask |= leftMoves;
                                        break;
                                    }
                                    // Ataca o rei para cima
                                    let upMoves = getU(i, OPPONENT_COLOR, tempBitboards);
                                    if (upMoves & KING_MASK) {
                                        attackerMask |= upMoves;
                                        break;
                                    }
                                    // Ataca o rei para baixo
                                    let downMoves = getD(i, OPPONENT_COLOR, tempBitboards);
                                    if (downMoves & KING_MASK) {
                                        attackerMask |= downMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal superior direita
                                    let upperRightMoves = getUR(i, OPPONENT_COLOR, tempBitboards);
                                    if (upperRightMoves & KING_MASK) {
                                        attackerMask |= upperRightMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal superior esquerda
                                    let upperLeftMoves = getUL(i, OPPONENT_COLOR, tempBitboards);
                                    if (upperLeftMoves & KING_MASK) {
                                        attackerMask |= upperLeftMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal inferior direita
                                    let lowerRightMoves = getLR(i, OPPONENT_COLOR, tempBitboards);
                                    if (lowerRightMoves & KING_MASK) {
                                        attackerMask |= lowerRightMoves;
                                        break;
                                    }
                                    // Ataca o rei na diagonal inferior esquerda
                                    let lowerLeftMoves = getLL(i, OPPONENT_COLOR, tempBitboards);
                                    if (lowerLeftMoves & KING_MASK) {
                                        attackerMask |= lowerLeftMoves;
                                        break;
                                    }
                                }
                                break;
                            case PAWN:
                            case KNIGHT:
                            case KING:
                                // Não realizam ataques descobertos
                                break;
                            default:
                                throw new Error("Invalid piece!");
                        }
                    }
                }
            }
            // Verifica se o rei recebe mais de um ataque quando a peça selecionada é removida
            if (count > 1) {
                return 0n;
            }
            // Movimentos que a peça pode realizar: capturar ou entrar na linha de ataque
            let defenderMoves = 0n;
            switch (piece) {
                case PAWN:
                    defenderMoves = getPawnMoves(fromPosition, color, tempBitboards, null);
                    break;
                case ROOK:
                    defenderMoves = getRookMoves(fromPosition, color, tempBitboards);
                    break;
                case KNIGHT:
                    defenderMoves = getKnightMoves(fromPosition, color, tempBitboards);
                    break;
                case BISHOP:
                    defenderMoves = getBishopMoves(fromPosition, color, tempBitboards);
                    break;
                case QUEEN:
                    defenderMoves = getQueenMoves(fromPosition, color, tempBitboards);
                    break;
            }
            if (attackerMask & defenderMoves) {
                return attackerMask & defenderMoves;
            }
            return 0n;
        }
        return null;
    }

    /**
     * Verifica se o rei está em xeque
     * @param {Array<Array<BigInt>>} bitboards
     * @param {Integer} color 
     * @returns mascara de bits do rei em xeque ou 0n se não estiver em xeque
     */
    isKingInCheck(bitboards, color) {
        const OPPONENT_COLOR = color === WHITE ? BLACK : WHITE;
        if (bitboards[color][KING] & this.getAttackerMask(OPPONENT_COLOR, bitboards)) {
            return bitboards[color][KING];
        }
        return 0n;
    }

    /**
     * Obtem os movimentos possíveis de uma peça
     * @param {Integer} from
     * @param {Integer} piece
     * @param {Integer} color
     * @param {Array<Array<BigInt>>} bitboards
     * @returns {BigInt} Mascara dos movimentos da peça
     */
    getPieceMovesMask(from, piece, color, bitboards, enPassant) {
        let moves = 0n;
        switch (piece) {
            case PAWN:
                moves |= getPawnMoves(from, color, bitboards, enPassant);
                break;
            case ROOK:
                moves |= getRookMoves(from, color, bitboards);
                break;
            case KNIGHT:
                moves |= getKnightMoves(from, color, bitboards);
                break;
            case BISHOP:
                moves |= getBishopMoves(from, color, bitboards);
                break;
            case QUEEN:
                moves |= getQueenMoves(from, color, bitboards);
                break;
            case KING:
                moves |= this.getKingSafeMoves(from, color, bitboards);
                break;
            default:
                throw new Error("Piece not found!");
        }
        return moves;
    }

    // Verifica se o movimento é ilegal a partir das variaveis globais
    isIllegalMove() {
        const OPPONENT_COLOR = this.selectedColor === WHITE ? BLACK : WHITE;
        // Copia o estado atual das peças
        let tempBitboards = [
            this.bitboards[WHITE].map(bitboard => BigInt(bitboard)),
            this.bitboards[BLACK].map(bitboard => BigInt(bitboard))
        ];
        // Remove a posição de origem
        tempBitboards[this.selectedColor][this.selectedPiece] &= ~(1n << BigInt(this.fromPosition));
        // Adiciona na nova posição
        tempBitboards[this.selectedColor][this.selectedPiece] |= 1n << BigInt(this.toPosition);
        // remove a peça adversária da posição de destino
        for (let p = 0; p < 6; p++) {
            tempBitboards[OPPONENT_COLOR][p] &= ~(1n << BigInt(this.toPosition));
        }
        // Na captura en passant o peão capturado não está na casa de destino: remove ele também
        const EN_PASSANT_SQUARE = this.selectedColor === WHITE ? this.enPassant + 8 : this.enPassant - 8;
        if (this.selectedPiece === PAWN && this.enPassant !== null && this.toPosition === EN_PASSANT_SQUARE) {
            tempBitboards[OPPONENT_COLOR][PAWN] &= ~(1n << BigInt(this.enPassant));
        }
        // Retorna verdadeiro se o rei estiver em xeque
        return this.isKingInCheck(tempBitboards, this.selectedColor);
    }

    /**
     * Obtem os movimentos seguros para o rei, considerando possíveis ataques adversários
     * @param {Integer} from
     * @param {Integer} color
     * @param {Array<Array<BigInt>>} bitboards
     * @returns {BigInt} Mascara dos movimentos seguros do rei
     */
    getKingSafeMoves(from, color, bitboards) {
        // Movimentos possíveis do rei
        let movesMask = 0n;
        // Constantes
        const OPPONENT_COLOR = color === WHITE ? BLACK : WHITE;
        const OPPONENT_PIECES = bitboards[OPPONENT_COLOR][PAWN] | bitboards[OPPONENT_COLOR][KNIGHT] | bitboards[OPPONENT_COLOR][BISHOP]
            | bitboards[OPPONENT_COLOR][ROOK] | bitboards[OPPONENT_COLOR][QUEEN] | bitboards[OPPONENT_COLOR][KING];
        let kingMovesMask = getKingMoves(from, color, bitboards);
        // copia o estado atual das peças
        let tempBitboards = [
            bitboards[WHITE].map(bitboard => BigInt(bitboard)),
            bitboards[BLACK].map(bitboard => BigInt(bitboard))
        ];
        // Remove o rei da posição de origem
        tempBitboards[color][KING] &= ~(1n << BigInt(from))
        // Obtem a mascara de todos os ataques possíveis
        const ATTACKER_MASK = this.getAttackerMask(OPPONENT_COLOR, tempBitboards);
        // Adiciona o rei novamente na posição de origem
        tempBitboards[color][KING] |= 1n << BigInt(from);
        // Remove os movimentos que o rei não pode realizar
        movesMask = (kingMovesMask & ~ATTACKER_MASK);
        // Verifica se o rei pode capturar alguma peça adversária
        if (movesMask & OPPONENT_PIECES) {
            // Itera sobre todas as peças adversárias
            for (let p = 0; p < 6; p++) {
                // Verifica se o movimento do rei coincide com a posição de alguma das peças adversárias
                if (bitboards[OPPONENT_COLOR][p] & movesMask) {
                    // Itera sobre o bitboard
                    for (let i = 0; i < 64; i++) {
                        // Verifica se a peça coincide com o movimento do rei
                        if (movesMask & 1n << BigInt(i) && bitboards[OPPONENT_COLOR][p] & 1n << BigInt(i)) {
                            // Remove a peça do adversário
                            tempBitboards[OPPONENT_COLOR][p] &= ~(1n << BigInt(i));
                            // Remove o rei da posição de origem
                            tempBitboards[color][KING] &= ~(1n << BigInt(from));
                            // Adiciona o rei na nova posição
                            tempBitboards[color][KING] |= 1n << BigInt(i);
                            // verifica se o rei está em xeque após a captura
                            if (this.isKingInCheck(tempBitboards, color)) {
                                // remove o movimento de captura SE o rei estiver em xeque
                                movesMask &= ~(1n << BigInt(i));
                            }
                            // Remove o rei da nova posição
                            tempBitboards[color][KING] &= ~(1n << BigInt(i));
                            // Adiciona o rei na posição de origem
                            tempBitboards[color][KING] |= 1n << BigInt(from);
                            // Adiciona a peça do adversário
                            tempBitboards[OPPONENT_COLOR][p] |= 1n << BigInt(i);
                        }
                    }
                }
            }
        }
        return movesMask;
    }

    /**
     * Obtem a mascara de todos os ataques possiveis
     * @param {Integer} color
     * @param {Array<Array<BigInt>>} bitboards
     * @returns {BigInt} 
     */
    getAttackerMask(color, bitboards) {
        let attackerMask = 0n;
        for (let op = 0; op < 6; op++) {
            for (let i = 0; i < 64; i++) {
                if (bitboards[color][op] & (1n << BigInt(i))) {
                    switch (op) {
                        case PAWN:
                            attackerMask |= getPawnAttackerMask(i, color);
                            break;
                        case ROOK:
                            attackerMask |= getRookMoves(i, color, bitboards);
                            break;
                        case KNIGHT:
                            attackerMask |= getKnightMoves(i, color, bitboards);
                            break;
                        case BISHOP:
                            attackerMask |= getBishopMoves(i, color, bitboards);
                            break;
                        case QUEEN:
                            attackerMask |= getQueenMoves(i, color, bitboards);
                            break;
                        case KING:
                            attackerMask |= getKingMoves(i, color, bitboards);
                            break;
                    }
                }
            }
        }
        return attackerMask;
    }

    /**
     * Obtem todos os movimentos possíveis para a defesa do rei
     * @param {Array<Array<BigInt>>} bitboards
     * @param {Integer} color 
     * @returns mascara de bits dos movimentos possíveis de defesa
     */
    getDefenderMovesMask(color) {
        // Copia o estado atual das peças
        let tempBitboards = [
            this.bitboards[WHITE].map(bitboard => BigInt(bitboard)), // Copia o array de peças brancas
            this.bitboards[BLACK].map(bitboard => BigInt(bitboard))  // Copia o array de peças pretas
        ];
        const KING_MASK = this.bitboards[color][KING];
        const OPPONENT_COLOR = color === WHITE ? BLACK : WHITE;
        // Mascara de bits dos ataques ao rei
        let attackerMask = 0n;
        // Posição das peças atacantes
        let attackerPositionMask = 0n;
        // Contador de peças atacantes
        let attackersCount = 0;

        // Verifica a posição de quem realiza os ataques
        for (let p = 0; p < 6; p++) {
            // Obtem o bitboard da peça
            let bitboard = tempBitboards[OPPONENT_COLOR][p];
            // Obtem a posição da(s) peça(s) atacante(s) e os movimentos de ataque
            for (let i = 0; i < 64; i++) {
                // Verifica se existe uma peça na posição i
                if (bitboard & (1n << BigInt(i))) {
                    // Escolhe o tipo da peça
                    switch (p) {
                        case ROOK:
                            // Verifica se a torre ataca o rei
                            if (getRookMoves(i, OPPONENT_COLOR, tempBitboards) & KING_MASK) {
                                attackersCount++;
                                attackerPositionMask |= 1n << BigInt(i);
                                // Obtem a direção do ataque
                                // Ataca o rei na direita
                                let rightMoves = getR(i, OPPONENT_COLOR, tempBitboards);
                                if (rightMoves & KING_MASK) {
                                    attackerMask |= rightMoves;
                                    break;
                                }
                                // Ataca o rei na esquerda
                                let leftMoves = getL(i, OPPONENT_COLOR, tempBitboards);
                                if (leftMoves & KING_MASK) {
                                    attackerMask |= leftMoves;
                                    break;
                                }
                                // Ataca o rei para cima
                                let upMoves = getU(i, OPPONENT_COLOR, tempBitboards);
                                if (upMoves & KING_MASK) {
                                    attackerMask |= upMoves;
                                    break;
                                }
                                // Ataca o rei para baixo
                                let downMoves = getD(i, OPPONENT_COLOR, tempBitboards);
                                if (downMoves & KING_MASK) {
                                    attackerMask |= downMoves;
                                    break;
                                }
                            }
                            break;
                        case BISHOP:
                            // Verifica se o bispo ataca o rei
                            if (getBishopMoves(i, OPPONENT_COLOR, tempBitboards) & KING_MASK) {
                                attackersCount++;
                                attackerPositionMask |= 1n << BigInt(i);
                                // Obtem a direção do ataque
                                // Ataca o rei na diagonal superior direita
                                let upperRightMoves = getUR(i, OPPONENT_COLOR, tempBitboards);
                                if (upperRightMoves & KING_MASK) {
                                    attackerMask |= upperRightMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal superior esquerda
                                let upperLeftMoves = getUL(i, OPPONENT_COLOR, tempBitboards);
                                if (upperLeftMoves & KING_MASK) {
                                    attackerMask |= upperLeftMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal inferior direita
                                let lowerRightMoves = getLR(i, OPPONENT_COLOR, tempBitboards);
                                if (lowerRightMoves & KING_MASK) {
                                    attackerMask |= lowerRightMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal inferior esquerda
                                let lowerLeftMoves = getLL(i, OPPONENT_COLOR, tempBitboards);
                                if (lowerLeftMoves & KING_MASK) {
                                    attackerMask |= lowerLeftMoves;
                                    break;
                                }
                            }
                            break;
                        case QUEEN:
                            // Verifica se a dama ataca o rei
                            if (getQueenMoves(i, OPPONENT_COLOR, tempBitboards) & KING_MASK) {
                                attackersCount++;
                                attackerPositionMask |= 1n << BigInt(i);
                                // Obtem a direção do ataque
                                // Ataca o rei na direita
                                let rightMoves = getR(i, OPPONENT_COLOR, tempBitboards);
                                if (rightMoves & KING_MASK) {
                                    attackerMask |= rightMoves;
                                    break;
                                }
                                // Ataca o rei na esquerda
                                let leftMoves = getL(i, OPPONENT_COLOR, tempBitboards);
                                if (leftMoves & KING_MASK) {
                                    attackerMask |= leftMoves;
                                    break;
                                }
                                // Ataca o rei para cima
                                let upMoves = getU(i, OPPONENT_COLOR, tempBitboards);
                                if (upMoves & KING_MASK) {
                                    attackerMask |= upMoves;
                                    break;
                                }
                                // Ataca o rei para baixo
                                let downMoves = getD(i, OPPONENT_COLOR, tempBitboards);
                                if (downMoves & KING_MASK) {
                                    attackerMask |= downMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal superior direita
                                let upperRightMoves = getUR(i, OPPONENT_COLOR, tempBitboards);
                                if (upperRightMoves & KING_MASK) {
                                    attackerMask |= upperRightMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal superior esquerda
                                let upperLeftMoves = getUL(i, OPPONENT_COLOR, tempBitboards);
                                if (upperLeftMoves & KING_MASK) {
                                    attackerMask |= upperLeftMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal inferior direita
                                let lowerRightMoves = getLR(i, OPPONENT_COLOR, tempBitboards);
                                if (lowerRightMoves & KING_MASK) {
                                    attackerMask |= lowerRightMoves;
                                    break;
                                }
                                // Ataca o rei na diagonal inferior esquerda
                                let lowerLeftMoves = getLL(i, OPPONENT_COLOR, tempBitboards);
                                if (lowerLeftMoves & KING_MASK) {
                                    attackerMask |= lowerLeftMoves;
                                    break;
                                }
                            }
                            break;
                        case PAWN:
                            const PAWN_ATTACKER_MASK = getPawnAttackerMask(i, OPPONENT_COLOR);
                            if (PAWN_ATTACKER_MASK & KING_MASK) {
                                attackersCount++;
                                attackerPositionMask |= 1n << BigInt(i);
                                attackerMask |= (PAWN_ATTACKER_MASK & KING_MASK);
                            }
                            break;
                        case KNIGHT:
                            // Verifica se o cavalo ataca o rei
                            const KNIGHT_ATTACKER_MASK = getKnightMoves(i, OPPONENT_COLOR, tempBitboards);
                            if (KNIGHT_ATTACKER_MASK & KING_MASK) {
                                attackersCount++;
                                attackerPositionMask |= 1n << BigInt(i);
                                attackerMask |= (KNIGHT_ATTACKER_MASK & KING_MASK);
                            }
                            break;
                        default:
                            break;
                    }
                }
            }
        }
        // Posicao do rei
        let kingIndexPosition = 0;
        // Obtem a posição do rei
        for (let i = 0; i < 64; i++) {
            if (KING_MASK & (1n << BigInt(i))) {
                kingIndexPosition = i;
                break;
            }
        }
        // Mascara de bits dos movimentos de defesa
        let defenderMask = 0n;
        // Obtem os movimentos possíveis do rei
        let kingMovesMask = this.getKingSafeMoves(kingIndexPosition, color, tempBitboards);
        // adiciona os movimentos do rei na mascara de defesa
        defenderMask |= kingMovesMask;
        // Peça que está atacando o rei
        let opponentPiece = null;
        // Se for atacado por mais de uma peça, somente o movimento de rei é possível	
        if (attackersCount > 1) {
            return kingMovesMask;
        }

        // Verificar se alguma peça aliada pode capturar ou entrar na frente de quem está atacando o rei
        for (let p = 0; p < 6; p++) {
            // Bitboard da peça
            let bitboard = tempBitboards[color][p];
            // Percorre as posições do bitboard
            for (let i = 0; i < 64; i++) {
                // Verifica se existe uma peça na posição i
                if (bitboard & (1n << BigInt(i))) {
                    // raio-x na peça adversária
                    let isXrayOpponentPiece = false;
                    // Remove temporariamente a peça que está atacando o rei
                    for (let op = 0; op < 6; op++) {
                        if (tempBitboards[OPPONENT_COLOR][op] & attackerPositionMask) {
                            tempBitboards[OPPONENT_COLOR][op] &= ~attackerPositionMask;
                            opponentPiece = op;
                            break;
                        }
                    }
                    // Verifica se existe uma peça que realiza raio-x quando a peça do adversario é removida
                    if (this.isKingInCheck(tempBitboards, color)) {
                        // Coloca temporariamente um peão aliado na posição da peça adversária removida
                        tempBitboards[color][PAWN] |= attackerPositionMask;
                        // Indica a alteração da peça pelo peão
                        isXrayOpponentPiece = true;
                    }
                    // Remove temporariamente a peça defensora
                    tempBitboards[color][p] &= ~(1n << BigInt(i));
                    // Verifica se o rei fica em xeque após a remoção da peça defensora
                    let pinnedAnotherPiece = this.isKingInCheck(tempBitboards, color);
                    // Remove o peão adicionado temporariamente (se adicionado)
                    if (isXrayOpponentPiece) tempBitboards[color][PAWN] &= ~attackerPositionMask;
                    // Restaura as peças que foram removidas
                    tempBitboards[color][p] |= 1n << BigInt(i);
                    tempBitboards[OPPONENT_COLOR][opponentPiece] |= attackerPositionMask;
                    // Se não estiver cravada por outro ataque
                    if (!pinnedAnotherPiece) {
                        // Escolhe o tipo da peça
                        switch (p) {
                            case PAWN:
                                let pawnMoves = getPawnMoves(i, color, tempBitboards, this.enPassant);
                                // Verifica se o peão pode se mover para a posição do ataque
                                if (pawnMoves & attackerMask) {
                                    defenderMask |= (pawnMoves & attackerMask);
                                }
                                // Verifica se o peão pode capturar a peça que está atacando o rei
                                let pawnAttackerMask = getPawnAttackerMask(i, color);
                                if (pawnAttackerMask & attackerPositionMask) {
                                    defenderMask |= (pawnAttackerMask & attackerPositionMask);
                                }
                                // Captura en passant do peão que está atacando o rei: o destino é a casa atrás dele
                                if (this.enPassant !== null && ((1n << BigInt(this.enPassant)) & attackerPositionMask)) {
                                    const EN_PASSANT_SQUARE = color === WHITE ? this.enPassant + 8 : this.enPassant - 8;
                                    defenderMask |= pawnMoves & (1n << BigInt(EN_PASSANT_SQUARE));
                                }
                                break;
                            case ROOK:
                                let rookMoves = getRookMoves(i, color, tempBitboards);
                                defenderMask |= (rookMoves & (attackerMask | attackerPositionMask));
                                break;
                            case KNIGHT:
                                let knightMoves = getKnightMoves(i, color, tempBitboards);
                                defenderMask |= (knightMoves & (attackerMask | attackerPositionMask));
                                break;
                            case BISHOP:
                                let bishopMoves = getBishopMoves(i, color, tempBitboards);
                                defenderMask |= (bishopMoves & (attackerMask | attackerPositionMask));
                                break;
                            case QUEEN:
                                let queenMoves = getQueenMoves(i, color, tempBitboards);
                                defenderMask |= (queenMoves & (attackerMask | attackerPositionMask));
                                break;
                            case KING:
                                // O rei não pode defender ele mesmo
                                break;
                            default:
                                throw new Error(`${p} Invalid piece!`);
                        }
                    }
                }
            }
        }
        return defenderMask;
    }

    getCastlingMovesMask(color) {
        // Mascara de bits dos movimentos de roque
        let castlingMoves = 0n;
        // Mascara de bits de todas as peças do tabuleiro
        const BLACK_PIECES = this.bitboards[BLACK][PAWN] | this.bitboards[BLACK][KNIGHT] | this.bitboards[BLACK][BISHOP] | this.bitboards[BLACK][ROOK]
            | this.bitboards[BLACK][QUEEN] | this.bitboards[BLACK][KING];
        const WHITE_PIECES = this.bitboards[WHITE][PAWN] | this.bitboards[WHITE][KNIGHT] | this.bitboards[WHITE][BISHOP] | this.bitboards[WHITE][ROOK]
            | this.bitboards[WHITE][QUEEN] | this.bitboards[WHITE][KING];
        const ALL_PIECES = BLACK_PIECES | WHITE_PIECES;
        // Verifica se o rei está em xeque
        if (this.isKingInCheck(this.bitboards, color)) return 0n;
        // Verifica a cor das peças
        if (color === WHITE) {
            // Verifica a torre da ala do rei
            if (this.availableCastlingMask & WHITE_ROOK_KINGSIDE) {
                // Verifica se as casas entre o rei e a torre estão vazias
                if (!(WHITE_KINGSIDE_CASTLING_EMPTY & ALL_PIECES)) {
                    // Verifica se o rei pode ir para a posição F1 
                    if (this.getKingSafeMoves(3, WHITE, this.bitboards) & 1n << BigInt(2)) {
                        // verifica se pode ir para posição final G1 (da posição F1)
                        if (this.getKingSafeMoves(2, WHITE, this.bitboards) & 1n << BigInt(1)) {
                            // Adiciona o roque curto na mascara de movimentos
                            castlingMoves |= 1n << BigInt(1);
                        }
                    }
                }
            }
            // Verifica a torre da ala da dama
            if (this.availableCastlingMask & WHITE_ROOK_QUEENSIDE) {
                // Verifica se as casas entre o rei e a torre estão vazias
                if (!(WHITE_QUEENSIDE_CASTLING_EMPTY & ALL_PIECES)) {
                    // Verifica se o rei pode ir para a posição D1
                    if (this.getKingSafeMoves(3, WHITE, this.bitboards) & 1n << BigInt(4)) {
                        // verifica se pode ir para posição final C1 (da posição D1)
                        if (this.getKingSafeMoves(4, WHITE, this.bitboards) & 1n << BigInt(5)) {
                            // Adiciona o roque grande na mascara de movimentos
                            castlingMoves |= 1n << BigInt(5);
                        }
                    }
                }
            }
        } else { // color === BLACK
            // Verifica a torre da ala do rei
            if (this.availableCastlingMask & BLACK_ROOK_KINGSIDE) {
                // Verifica se as casas entre o rei e a torre estão vazias
                if (!(BLACK_KINGSIDE_CASTLING_EMPTY & ALL_PIECES)) {
                    // Verifica se o rei pode ir para a posição F8
                    if (this.getKingSafeMoves(59, BLACK, this.bitboards) & 1n << BigInt(58)) {
                        // verifica se pode ir para posição final G8 (da posição F8)
                        if (this.getKingSafeMoves(58, BLACK, this.bitboards) & 1n << BigInt(57)) {
                            // Adiciona o roque curto na mascara de movimentos
                            castlingMoves |= 1n << BigInt(57);
                        }
                    }
                }
            }
            // Verifica a torre da ala da dama
            if (this.availableCastlingMask & BLACK_ROOK_QUEENSIDE) {
                // Verifica se as casas entre o rei e a torre estão vazias
                if (!(BLACK_QUEENSIDE_CASTLING_EMPTY & ALL_PIECES)) {
                    // Verifica se o rei pode ir para a posição D8
                    if (this.getKingSafeMoves(59, BLACK, this.bitboards) & 1n << BigInt(60)) {
                        // verifica se pode ir para posição final C8 (da posição D8)
                        if (this.getKingSafeMoves(60, BLACK, this.bitboards) & 1n << BigInt(61)) {
                            // Adiciona o roque grande na mascara de movimentos
                            castlingMoves |= 1n << BigInt(61);
                        }
                    }
                }
            }
        }
        return castlingMoves;
    }

}
export default Board;