import { uploadFolder } from "#methods";
import { alphaPing } from "#mod/alpha";

export function handle(): string {
  alphaPing();
  return uploadFolder();
}
