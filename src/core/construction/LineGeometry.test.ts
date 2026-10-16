import { describe, expect, it } from 'vitest';
import { computeLineCells } from './LineGeometry';

describe('LineGeometry — computeLineCells', () => {
  it('geração de linha horizontal da esquerda para a direita', () => {
    const cells = computeLineCells([10, 20], [14, 20]);
    expect(cells).toEqual([
      [10, 20],
      [11, 20],
      [12, 20],
      [13, 20],
      [14, 20],
    ]);
  });

  it('geração de linha horizontal reversa (arrasto inverso)', () => {
    const cells = computeLineCells([14, 20], [10, 20]);
    expect(cells).toEqual([
      [14, 20],
      [13, 20],
      [12, 20],
      [11, 20],
      [10, 20],
    ]);
  });

  it('geração de linha vertical de cima para baixo', () => {
    const cells = computeLineCells([10, 20], [10, 24]);
    expect(cells).toEqual([
      [10, 20],
      [10, 21],
      [10, 22],
      [10, 23],
      [10, 24],
    ]);
  });

  it('geração de linha vertical reversa (arrasto de baixo para cima)', () => {
    const cells = computeLineCells([10, 24], [10, 20]);
    expect(cells).toEqual([
      [10, 24],
      [10, 23],
      [10, 22],
      [10, 21],
      [10, 20],
    ]);
  });

  it('linha de apenas uma célula quando início e fim coincidem', () => {
    const cells = computeLineCells([15, 30], [15, 30]);
    expect(cells).toEqual([[15, 30]]);
  });

  it('eixo predominante: se |dx| >= |dy|, prioriza horizontal', () => {
    // dx = 4, dy = 3 -> horizontal
    const cellsH = computeLineCells([10, 10], [14, 13]);
    expect(cellsH).toEqual([
      [10, 10],
      [11, 10],
      [12, 10],
      [13, 10],
      [14, 10],
    ]);

    // dx = 3, dy = 3 (|dx| == |dy|) -> horizontal
    const cellsEqual = computeLineCells([10, 10], [13, 13]);
    expect(cellsEqual).toEqual([
      [10, 10],
      [11, 10],
      [12, 10],
      [13, 10],
    ]);

    // dx = 2, dy = 4 -> vertical
    const cellsV = computeLineCells([10, 10], [12, 14]);
    expect(cellsV).toEqual([
      [10, 10],
      [10, 11],
      [10, 12],
      [10, 13],
      [10, 14],
    ]);
  });

  it('limita coordenadas fora dos limites do mapa (clamping aos bounds)', () => {
    const bounds = { width: 200, height: 200 };
    // Arrasto além do limite leste (x > 199)
    const cellsEast = computeLineCells([196, 50], [210, 50], bounds);
    expect(cellsEast).toEqual([
      [196, 50],
      [197, 50],
      [198, 50],
      [199, 50],
    ]);

    // Arrasto além do limite oeste (x < 0)
    const cellsWest = computeLineCells([3, 50], [-10, 50], bounds);
    expect(cellsWest).toEqual([
      [3, 50],
      [2, 50],
      [1, 50],
      [0, 50],
    ]);

    // Arrasto além do limite sul (y > 199)
    const cellsSouth = computeLineCells([50, 197], [50, 205], bounds);
    expect(cellsSouth).toEqual([
      [50, 197],
      [50, 198],
      [50, 199],
    ]);

    // Arrasto além do limite norte (y < 0)
    const cellsNorth = computeLineCells([50, 2], [50, -5], bounds);
    expect(cellsNorth).toEqual([
      [50, 2],
      [50, 1],
      [50, 0],
    ]);
  });
});
