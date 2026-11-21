const AUDIO_EXT = /\.(mp3|flac|wav|ogg|oga|opus|m4a|aac|weba|webm)$/i;

/** Sürüklenen / seçilen dosyalardan ses dosyalarını ayıklar (MIME tipi boş gelebildiği için uzantıya da bakar). */
export function audioFiles(list: FileList | readonly File[]): File[] {
  return Array.from(list).filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
}

/** Gösterim için dosya adından uzantıyı atar. */
export const trackTitle = (name: string): string => name.replace(/\.[^.]+$/, '');
