// 可注入随机数接口。生产环境用 crypto 生成种子；测试用固定种子。
// 种子只保存在服务端状态中，绝不进入玩家视图。

export interface Rng {
  next(): number; // [0,1)
  int(exclusiveMax: number): number; // [0, exclusiveMax)
  shuffle<T>(arr: T[]): T[]; // 就地洗牌，返回同一数组
  exportState(): number[];
}

// xorshift128 — 确定性，可序列化状态
export class SeededRng implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // 用混合打散种子
    let x = seed | 0 || 0x9e3779b9;
    const mix = () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x | 0;
    };
    this.s0 = mix() || 1;
    this.s1 = mix() || 2;
    this.s2 = mix() || 3;
    this.s3 = mix() || 4;
  }

  exportState(): number[] {
    return [this.s0 | 0, this.s1 | 0, this.s2 | 0, this.s3 | 0];
  }

  static fromState(state: number[]): SeededRng {
    const rng = new SeededRng(0);
    rng.s0 = state[0] | 0;
    rng.s1 = state[1] | 0;
    rng.s2 = state[2] | 0;
    rng.s3 = state[3] | 0;
    return rng;
  }

  private step(): number {
    let t = this.s3;
    const s = this.s0;
    this.s3 = this.s2;
    this.s2 = this.s1;
    this.s1 = s;
    t ^= t << 11;
    t ^= t >>> 8;
    this.s0 = t ^ s ^ (s >>> 19);
    return this.s0 >>> 0;
  }

  next(): number {
    return this.step() / 0x100000000;
  }

  int(exclusiveMax: number): number {
    if (exclusiveMax <= 0) throw new Error('int(): exclusiveMax 必须 > 0');
    return Math.floor(this.next() * exclusiveMax);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export function randomSeed(): number {
  // 32 位安全随机种子（Node/Web 兼容）
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] | 0;
  }
  return Math.floor(Math.random() * 0x100000000) | 0;
}
