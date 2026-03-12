import {
  getTypeCode,
  isValueType,
  parseSaveGame,
  SerializationTypeCode,
  writeSaveGame,
  type TypeInfo,
  type TypeTemplate,
} from "oni-save-parser";

import {
  SaveParserCommandEvent,
  ParseSaveCommand,
  WriteSaveCommand,
  parseSaveError,
  parseSaveSuccess,
  writeSaveError,
  writeSaveSuccess,
  sendProgress,
} from "./worker-messages";

interface KleiStringWriteInstruction {
  type: "write";
  dataType: "klei-string";
  value?: unknown;
}

interface ByteArrayWriteInstruction {
  type: "write";
  dataType: "byte-array";
  value?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isUndefinedKleiStringWriteInstruction(
  instruction: unknown
): instruction is KleiStringWriteInstruction {
  if (!isObjectRecord(instruction)) {
    return false;
  }

  return (
    instruction.type === "write" &&
    instruction.dataType === "klei-string" &&
    instruction.value === undefined
  );
}

function isByteArrayWriteInstruction(
  instruction: unknown
): instruction is ByteArrayWriteInstruction {
  if (!isObjectRecord(instruction)) {
    return false;
  }

  return instruction.type === "write" && instruction.dataType === "byte-array";
}

function toByteArray(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  if (
    isObjectRecord(value) &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  ) {
    return Uint8Array.from(value.data);
  }

  if (isObjectRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
      const sortedKeys = keys.sort(
        (left, right) => Number(left) - Number(right)
      );
      const byteValues = sortedKeys.map((key) => value[key]);
      if (
        sortedKeys.every((key, index) => Number(key) === index) &&
        byteValues.every(isByteNumber)
      ) {
        return Uint8Array.from(byteValues);
      }
    }
  }

  return new Uint8Array(0);
}

function normalizeInstruction(instruction: unknown): unknown {
  if (isUndefinedKleiStringWriteInstruction(instruction)) {
    return {
      ...instruction,
      value: null,
    };
  }

  if (isByteArrayWriteInstruction(instruction)) {
    return {
      ...instruction,
      value: toByteArray(instruction.value),
    };
  }

  if (!isObjectRecord(instruction) || instruction.type !== "write") {
    return instruction;
  }

  return instruction;
}

function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const view = value;
    return view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength
    );
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value).buffer;
  }

  return new ArrayBuffer(0);
}

function normalizeValueByType(
  value: unknown,
  typeInfo: TypeInfo,
  templateMap: ReadonlyMap<string, TypeTemplate>
): unknown {
  const typeCode = getTypeCode(typeInfo.info);

  switch (typeCode) {
    case SerializationTypeCode.String:
      return value === undefined ? null : value;
    case SerializationTypeCode.UserDefined:
      if (!typeInfo.templateName) {
        return value;
      }
      return normalizeValueByTemplate(
        value,
        typeInfo.templateName,
        templateMap
      );
    case SerializationTypeCode.Array:
    case SerializationTypeCode.List:
    case SerializationTypeCode.HashSet:
    case SerializationTypeCode.Queue:
      return normalizeListLikeValue(value, typeInfo, templateMap);
    case SerializationTypeCode.Pair:
      return normalizePairValue(value, typeInfo, templateMap);
    case SerializationTypeCode.Dictionary:
      return normalizeDictionaryValue(value, typeInfo, templateMap);
    default:
      return value;
  }
}

function normalizeListLikeValue(
  value: unknown,
  typeInfo: TypeInfo,
  templateMap: ReadonlyMap<string, TypeTemplate>
): unknown {
  if (value == null) {
    return value;
  }

  const [elementType] = typeInfo.subTypes ?? [];
  if (!elementType) {
    return value;
  }

  const elementTypeCode = getTypeCode(elementType.info);
  if (elementTypeCode === SerializationTypeCode.Byte) {
    return toByteArray(value);
  }

  if (!Array.isArray(value)) {
    return value;
  }

  if (
    isValueType(elementType.info) &&
    elementTypeCode === SerializationTypeCode.UserDefined &&
    elementType.templateName
  ) {
    return value.map((entry) =>
      normalizeValueByTemplate(
        entry,
        elementType.templateName as string,
        templateMap
      )
    );
  }

  return value.map((entry) =>
    normalizeValueByType(entry, elementType, templateMap)
  );
}

function normalizePairValue(
  value: unknown,
  typeInfo: TypeInfo,
  templateMap: ReadonlyMap<string, TypeTemplate>
): unknown {
  if (!isObjectRecord(value)) {
    return value;
  }

  const [keyType, valueType] = typeInfo.subTypes ?? [];
  if (!keyType || !valueType) {
    return value;
  }

  return {
    ...value,
    key: normalizeValueByType(value.key, keyType, templateMap),
    value: normalizeValueByType(value.value, valueType, templateMap),
  };
}

function normalizeDictionaryValue(
  value: unknown,
  typeInfo: TypeInfo,
  templateMap: ReadonlyMap<string, TypeTemplate>
): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const [keyType, valueType] = typeInfo.subTypes ?? [];
  if (!keyType || !valueType) {
    return value;
  }

  return value.map((entry) => {
    if (!isObjectRecord(entry)) {
      return entry;
    }

    return {
      ...entry,
      key: normalizeValueByType(entry.key, keyType, templateMap),
      value: normalizeValueByType(entry.value, valueType, templateMap),
    };
  });
}

function normalizeValueByTemplate<T>(
  value: T,
  templateName: string,
  templateMap: ReadonlyMap<string, TypeTemplate>
): T {
  if (!isObjectRecord(value)) {
    return value;
  }

  const template = templateMap.get(templateName);
  if (!template) {
    return value;
  }

  const normalized: Record<string, unknown> = {
    ...value,
  };

  for (const member of [...template.fields, ...template.properties]) {
    normalized[member.name] = normalizeValueByType(
      normalized[member.name],
      member.type,
      templateMap
    );
  }

  return normalized as T;
}

function createTemplateMap(
  templates: TypeTemplate[]
): ReadonlyMap<string, TypeTemplate> {
  return new Map(templates.map((template) => [template.name, template]));
}

function isByteArrayType(typeInfo: TypeInfo): boolean {
  const typeCode = getTypeCode(typeInfo.info);
  if (
    typeCode !== SerializationTypeCode.Array &&
    typeCode !== SerializationTypeCode.List &&
    typeCode !== SerializationTypeCode.HashSet &&
    typeCode !== SerializationTypeCode.Queue
  ) {
    return false;
  }

  const [elementType] = typeInfo.subTypes ?? [];
  if (!elementType) {
    return false;
  }

  return getTypeCode(elementType.info) === SerializationTypeCode.Byte;
}

function collectByteArrayMemberNames(
  templates: TypeTemplate[]
): ReadonlySet<string> {
  const memberNames = new Set<string>();

  for (const template of templates) {
    for (const member of [...template.fields, ...template.properties]) {
      if (isByteArrayType(member.type)) {
        memberNames.add(member.name);
      }
    }
  }

  return memberNames;
}

function isByteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}

function normalizeByteLikeCollections(
  value: unknown,
  byteArrayMemberNames: ReadonlySet<string>,
  keyName?: string
): unknown {
  if (keyName && byteArrayMemberNames.has(keyName) && value != null) {
    return toByteArray(value);
  }

  if (Array.isArray(value)) {
    if (value.every(isByteNumber)) {
      return Uint8Array.from(value);
    }

    return value.map((entry) =>
      normalizeByteLikeCollections(entry, byteArrayMemberNames)
    );
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  if (value.type === "Buffer" && Array.isArray(value.data)) {
    return Uint8Array.from(value.data);
  }

  const numericKeys = Object.keys(value);
  if (numericKeys.length > 0 && numericKeys.every((key) => /^\d+$/.test(key))) {
    const sortedKeys = numericKeys.sort(
      (left, right) => Number(left) - Number(right)
    );
    const byteValues = sortedKeys.map((key) => value[key]);

    if (
      sortedKeys.every((key, index) => Number(key) === index) &&
      byteValues.every(isByteNumber)
    ) {
      return Uint8Array.from(byteValues);
    }
  }

  const normalized: Record<string, unknown> = {
    ...value,
  };

  for (const key of Object.keys(normalized)) {
    normalized[key] = normalizeByteLikeCollections(
      normalized[key],
      byteArrayMemberNames,
      key
    );
  }

  return normalized;
}

function normalizeSaveForWrite(command: WriteSaveCommand): WriteSaveCommand {
  const templateMap = createTemplateMap(command.saveGame.templates);
  const byteArrayMemberNames = collectByteArrayMemberNames(
    command.saveGame.templates
  );
  const normalizedSaveGame = normalizeByteLikeCollections(
    {
      ...command.saveGame,
      simData: toArrayBuffer(command.saveGame?.simData),
      world: normalizeValueByTemplate(
        command.saveGame.world,
        "Klei.SaveFileRoot",
        templateMap
      ),
    },
    byteArrayMemberNames
  );

  return {
    ...command,
    saveGame: normalizedSaveGame as WriteSaveCommand["saveGame"],
  };
}

addEventListener("message", handleMessage);

function handleMessage(message: SaveParserCommandEvent) {
  const { data: command } = message;
  if (!command || !command.type) {
    return;
  }

  switch (command.type) {
    case "parse-save":
      return parseSave(command);
    case "write-save":
      return writeSave(command);
  }
}

function parseSave(command: ParseSaveCommand) {
  const injector = progressReporter(onProgress);

  try {
    const save = parseSaveGame(command.data, {
      versionStrictness: "major",
      interceptor: injector,
    });
    postMessage(parseSaveSuccess(save));
  } catch (e: any) {
    postMessage(parseSaveError(e));
  }
}

function writeSave(command: WriteSaveCommand) {
  const normalizedCommand = normalizeSaveForWrite(command);
  const injector = progressReporter(onProgress);

  try {
    const data = writeSaveGame(normalizedCommand.saveGame, injector);
    postMessage(writeSaveSuccess(data));
  } catch (e: any) {
    postMessage(writeSaveError(e));
  }
}

// Copied from progressReporter of oni-save-parser and
//  modified to debounce messages
let messageQueueTime = 0;
let messageQueue: string | null = null;
function progressReporter(
  onProgress: (message: string) => void
): (value: any) => any {
  return (value: unknown) => {
    const instruction = normalizeInstruction(value);

    // Check if its time to emit a message.
    if (messageQueue && messageQueueTime + 200 < Date.now()) {
      onProgress(messageQueue);
      messageQueue = null;
      messageQueueTime = 0;
    }

    // Check if we have a message to queue up.
    if (isObjectRecord(instruction) && instruction.type === "progress") {
      const message =
        typeof instruction.message === "string" ? instruction.message : "";
      messageQueue = message;
      if (messageQueueTime === 0) {
        // Only set the time if we are not already set
        //  This ensures only the most recent message in
        //  the debounce time is sent.
        messageQueueTime = Date.now();
      }

      if (message.length === 0) {
        messageQueue = null;
      }
    }
    return instruction;
  };
}

let lastProgress: number = 0;
function onProgress(message: string) {
  const elapsed = Date.now() - lastProgress;
  if (elapsed > 200) {
    postMessage(sendProgress(message));
  }
}
