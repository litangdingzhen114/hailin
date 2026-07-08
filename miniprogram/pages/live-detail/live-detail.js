const { loadLives } = require('../../services/content');
const recommend = require('../../data/recommend');
const { findById, quickToast } = require('../../utils/mock');

const PACKAGE_LIVE_VIDEO = '/assets/videos/hailin-live.mp4';
const PACKAGE_LIVE_VIDEO_FALLBACK = '../../assets/videos/hailin-live.mp4';
const PACKAGE_LIVE_VIDEO_CANDIDATES = [
  '/assets/videos/hailin-live.mp4',
  'assets/videos/hailin-live.mp4',
  '../../assets/videos/hailin-live.mp4'
];
const USER_LIVE_VIDEO = typeof wx !== 'undefined' && wx && wx.env && wx.env.USER_DATA_PATH ? `${wx.env.USER_DATA_PATH}/hailin-live.mp4` : '';
const VIDEO_SOURCE_CANDIDATES = [
  USER_LIVE_VIDEO,
  PACKAGE_LIVE_VIDEO,
  PACKAGE_LIVE_VIDEO_FALLBACK
].filter(Boolean);

Page({
  data: {
    live: null,
    videoUrl: '',
    currentTime: '',
    nearby: recommend.corridor.slice(0, 3)
  },

  onLoad(options) {
    this.videoSourceIndex = -1;
    this.refreshClock();
    this.clockTimer = setInterval(() => {
      this.refreshClock();
    }, 1000);

    loadLives().then((lives) => {
      const live = findById(lives, options.id);
      this.setData({
        live
      });
      if (live) {
        this.prepareLocalVideo();
      }
    });
  },

  onUnload() {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  },

  refreshClock() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    this.setData({
      currentTime: `${date} ${time}`
    });
  },

  prepareLocalVideo() {
    const fs = wx.getFileSystemManager();
    if (!USER_LIVE_VIDEO) {
      this.useVideoSource(PACKAGE_LIVE_VIDEO);
      return;
    }

    fs.stat({
      filePath: USER_LIVE_VIDEO,
      success: (res) => {
        if (res.stats && res.stats.size > 1024) {
          this.useVideoSource(USER_LIVE_VIDEO);
          return;
        }
        this.copyPackageVideo(fs);
      },
      fail: () => {
        this.copyPackageVideo(fs);
      }
    });
  },

  copyPackageVideo(fs) {
    this.readPackageVideo(fs, 0, (data) => {
      fs.writeFile({
        filePath: USER_LIVE_VIDEO,
        data,
        success: () => {
          this.useVideoSource(USER_LIVE_VIDEO);
        },
        fail: (error) => {
          console.warn('write live video failed', error);
          this.useVideoSource(PACKAGE_LIVE_VIDEO);
        }
      });
    }, (error) => {
      console.warn('read package live video failed', error);
      this.useVideoSource(PACKAGE_LIVE_VIDEO);
    });
  },

  useVideoSource(source) {
    this.videoSourceIndex = Math.max(0, VIDEO_SOURCE_CANDIDATES.indexOf(source));
    this.setData({ videoUrl: source });
  },

  tryNextVideoSource() {
    const currentIndex = VIDEO_SOURCE_CANDIDATES.indexOf(this.data.videoUrl);
    const nextIndex = Math.max(this.videoSourceIndex || 0, currentIndex) + 1;
    const nextSource = VIDEO_SOURCE_CANDIDATES[nextIndex];
    if (nextSource) {
      this.videoSourceIndex = nextIndex;
      this.setData({ videoUrl: nextSource });
      quickToast('正在切换备用视频源');
      return;
    }
    this.videoSourceIndex = VIDEO_SOURCE_CANDIDATES.length;
    this.setData({ videoUrl: '' });
    quickToast('视频暂不可播放，已切换为封面预览');
  },

  readPackageVideo(fs, index, onSuccess, onFail, lastError) {
    const filePath = PACKAGE_LIVE_VIDEO_CANDIDATES[index];
    if (!filePath) {
      onFail(lastError);
      return;
    }

    fs.readFile({
      filePath,
      success: (res) => {
        onSuccess(res.data);
      },
      fail: (error) => {
        this.readPackageVideo(fs, index + 1, onSuccess, onFail, error);
      }
    });
  },

  onFullscreen() {
    if (this.data.videoUrl) {
      quickToast('正在播放海林实时视频');
      return;
    }
    quickToast('未配置真实直播流，当前显示本地封面');
  },

  onVideoError(event) {
    console.warn('live video error', event.detail);
    this.tryNextVideoSource();
  }

  // 真实直播密钥、萤石云 token 或 HLS 鉴权应由后端维护。
  // 后端可返回 liveUrl / hlsUrl，小程序端只负责播放地址。
});
