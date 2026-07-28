import { File } from 'expo-file-system';

export async function copyFileFromUri(sourceUri: string, destination: File): Promise<void> {
  await new File(sourceUri).copy(destination, { overwrite: true });
}
