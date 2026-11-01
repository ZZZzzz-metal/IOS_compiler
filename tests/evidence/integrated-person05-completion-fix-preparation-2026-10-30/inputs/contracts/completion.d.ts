/** Frozen optional editing service v1 (2026-10-29); owner02/04 API-ACK received.
 * Independent from build/debug protocol; no buildId/artifact is produced.
 */
import type {SourceSnapshot,Language,Diagnostic,Hash} from './protocol';
export type CompletionKind = 'variable'|'function'|'field'|'method'|'class'|'struct'|'namespace'|'keyword'|'enum'|'enumMember'|'type'|'unknown';
export interface CompletionRange {startOffset:number;endOffset:number}
export interface CompletionItem {id:string;label:string;kind:CompletionKind;detail:string;insertText:string;replaceRange:CompletionRange;sortText?:string;filterText?:string}
export type CompletionRequest = Language & {
 /** Unique in one adapter lifecycle; numeric fields are non-negative safe integers. */
 requestId:string;documentVersion:number;snapshot:SourceSnapshot;sourcePath:string;offset:number;
 trigger?:'identifier'|'.'|'->'|'::'|'manual';
};
/** Offsets are 0-based UTF16 boundaries in normalized snapshot sourcePath, end exclusive.
 * They may not split surrogate pairs. UI maps raw editor offsets/BOM/CRLF explicitly.
 * sourcePath may differ from translationUnit for user.inc included by driver.cpp.
 * sourcePath must exist in the validated snapshot. The compiler maps this UTF16
 * insertion point to the target file's 1-based line and UTF8 byte column.
 */
export interface CompletionResult {
 requestId:string;documentVersion:number;snapshotId:string;sourceHash:Hash;sourcePath:string;offset:number;
 status:'succeeded'|'failed'|'cancelled'|'unsupported';items:CompletionItem[];
 isIncomplete:boolean;diagnostics:Diagnostic[];reason?:string;
 toolchainId?:string;compilerResourceHash?:Hash;sysrootResourceHash?:Hash;
}
export interface CompletionAdapter {
 /** Empty succeeded items is a valid result. Incomplete source may still produce
  * valid Clang candidates despite a nonzero native exit code. Result identities,
  * unique item IDs and in-bounds replacement ranges must be checked before use.
  * Only succeeded results may contain items; insertion is plain text, no snippets.
  */
 complete(request:CompletionRequest):Promise<CompletionResult>;
 /** Idempotent and request-scoped. Resolves after the matched worker is released
  * and its complete Promise settles. Late replies cannot alter a newer request.
  * The caller awaits cancellation before starting a full compilation.
  */
 cancel(requestId:string):Promise<void>;
}
