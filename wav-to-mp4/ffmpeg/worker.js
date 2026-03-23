import { CORE_URL, FFMessageType } from './const.js';
import {
  ERROR_UNKNOWN_MESSAGE_TYPE,
  ERROR_NOT_LOADED,
  ERROR_IMPORT_FAILURE
} from './errors.js';

let ffmpeg;

const load = async ({ coreURL: customCoreURL, wasmURL: customWasmURL, workerURL: customWorkerURL }) => {
  const first = !ffmpeg;
  let resolvedCoreURL = customCoreURL;

  try {
    if (!resolvedCoreURL) resolvedCoreURL = CORE_URL;
    importScripts(resolvedCoreURL);
  } catch {
    if (!resolvedCoreURL || resolvedCoreURL === CORE_URL) {
      resolvedCoreURL = CORE_URL.replace('/umd/', '/esm/');
    }

    self.createFFmpegCore = (await import(/* @vite-ignore */ resolvedCoreURL)).default;
    if (!self.createFFmpegCore) {
      throw ERROR_IMPORT_FAILURE;
    }
  }

  const wasmURL = customWasmURL || resolvedCoreURL.replace(/\.js$/g, '.wasm');
  const workerURL = customWorkerURL || resolvedCoreURL.replace(/\.js$/g, '.worker.js');

  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${resolvedCoreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`
  });

  ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data) => self.postMessage({ type: FFMessageType.PROGRESS, data }));

  return first;
};

const exec = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const ffprobe = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const writeFile = ({ path, data }) => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });

const deleteFile = ({ path }) => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }) => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

const createDir = ({ path }) => {
  ffmpeg.FS.mkdir(path);
  return true;
};

const listDir = ({ path }) => {
  const names = ffmpeg.FS.readdir(path);
  const nodes = [];
  for (const name of names) {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    nodes.push({ name, isDir: ffmpeg.FS.isDir(stat.mode) });
  }
  return nodes;
};

const deleteDir = ({ path }) => {
  ffmpeg.FS.rmdir(path);
  return true;
};

const mount = ({ fsType, options, mountPoint }) => {
  const fs = ffmpeg.FS.filesystems[fsType];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};

const unmount = ({ mountPoint }) => {
  ffmpeg.FS.unmount(mountPoint);
  return true;
};

self.onmessage = async ({ data: { id, type, data } }) => {
  const transferables = [];
  let responseData;

  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) {
      throw ERROR_NOT_LOADED;
    }

    switch (type) {
      case FFMessageType.LOAD:
        responseData = await load(data);
        break;
      case FFMessageType.EXEC:
        responseData = exec(data);
        break;
      case FFMessageType.FFPROBE:
        responseData = ffprobe(data);
        break;
      case FFMessageType.WRITE_FILE:
        responseData = writeFile(data);
        break;
      case FFMessageType.READ_FILE:
        responseData = readFile(data);
        break;
      case FFMessageType.DELETE_FILE:
        responseData = deleteFile(data);
        break;
      case FFMessageType.RENAME:
        responseData = rename(data);
        break;
      case FFMessageType.CREATE_DIR:
        responseData = createDir(data);
        break;
      case FFMessageType.LIST_DIR:
        responseData = listDir(data);
        break;
      case FFMessageType.DELETE_DIR:
        responseData = deleteDir(data);
        break;
      case FFMessageType.MOUNT:
        responseData = mount(data);
        break;
      case FFMessageType.UNMOUNT:
        responseData = unmount(data);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (error) {
    self.postMessage({
      id,
      type: FFMessageType.ERROR,
      data: error.toString()
    });
    return;
  }

  if (responseData instanceof Uint8Array) {
    transferables.push(responseData.buffer);
  }

  self.postMessage({ id, type, data: responseData }, transferables);
};
