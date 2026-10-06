/**
 * Amostras float (−1…1) → WAV PCM 16 bits, mono. É o formato que qualquer
 * `decodeAudioData` lê, sem codec nenhum. Uma frase de 5 s a 22 050 Hz dá ~220 KB:
 * pela 127.0.0.1, nada.
 */

const CABECALHO = 44;

export function paraWav(amostras: Float32Array, taxa: number): Buffer {
  const dados = amostras.length * 2;
  const wav = Buffer.alloc(CABECALHO + dados);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dados, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16); // tamanho do bloco fmt
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(taxa, 24);
  wav.writeUInt32LE(taxa * 2, 28); // bytes por segundo
  wav.writeUInt16LE(2, 32); // bytes por quadro
  wav.writeUInt16LE(16, 34); // bits por amostra
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dados, 40);
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i] ?? 0));
    wav.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), CABECALHO + i * 2);
  }
  return wav;
}
