/**
 * Common interface for any AI Provider (Browser-based, API, or local)
 */
export interface AIProvider {
  readonly name: string;
  isReady(): boolean;
  sendPrompt(
    prompt: string,
    timeoutMs?: number,
    onStream?: (chunk: string, fullText: string) => void
  ): Promise<string>;
}
