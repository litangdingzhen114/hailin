const assert = require('assert');

const pagePath = require.resolve('../pages/live-detail/live-detail');

let pageConfig = null;
const toastTitles = [];
const originalWarn = console.warn;

console.warn = () => {};

global.Page = (config) => {
  pageConfig = config;
};
global.wx = {
  env: {
    USER_DATA_PATH: 'http://usr'
  },
  showToast(options) {
    toastTitles.push(options.title);
  }
};

delete require.cache[pagePath];
require(pagePath);

function createContext(videoUrl, videoSourceIndex) {
  return {
    ...pageConfig,
    videoSourceIndex,
    data: {
      videoUrl
    },
    setData(update) {
      Object.assign(this.data, update);
    }
  };
}

assert(pageConfig, 'live detail page should register config');

let context = createContext('http://usr/hailin-live.mp4', 0);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail user file' } });
assert.strictEqual(context.data.videoUrl, '/assets/videos/hailin-live.mp4');

context = createContext('/assets/videos/hailin-live.mp4', 1);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail package absolute' } });
assert.strictEqual(context.data.videoUrl, '../../assets/videos/hailin-live.mp4');

context = createContext('../../assets/videos/hailin-live.mp4', 2);
pageConfig.onVideoError.call(context, { detail: { errMsg: 'fail package relative' } });
assert.strictEqual(context.data.videoUrl, '');
assert(toastTitles.includes('视频暂不可播放，已切换为封面预览'));

delete global.Page;
delete global.wx;
console.warn = originalWarn;

console.log('live detail video fallback ok');
