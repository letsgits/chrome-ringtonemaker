let wavesurfer;
let audioContext;
let audioBuffer;

// 添加性能监控
performance.mark('appStart');
document.addEventListener('DOMContentLoaded', function() {
  performance.mark('appLoaded');
  performance.measure('appStartup', 'appStart', 'appLoaded');

  // 替换所有国际化消息
  document.body.innerHTML = document.body.innerHTML.replace(
    /__MSG_(\w+)__/g,
    function(match, key) {
      return chrome.i18n.getMessage(key) || match;
    }
  );

  // 初始化WaveSurfer
  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#5D4E8C',
    progressColor: '#4A3D70',
    cursorColor: '#4A3D70',
    height: 128,
    responsive: true,
    plugins: [
      WaveSurfer.Regions.create({
        dragSelection: {
          slop: 5
        },
        color: 'rgba(93, 78, 140, 0.3)',
        handleStyle: {
          left: {
            width: '3px',
            backgroundColor: '#5D4E8C',
            cursor: 'ew-resize'
          },
          right: {
            width: '3px',
            backgroundColor: '#5D4E8C',
            cursor: 'ew-resize'
          }
        }
      })
    ]
  });

  // 添加音频处理的错误检查
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    alert(chrome.i18n.getMessage('errorBrowserNotSupported'));
  }

  // 文件选择按钮
  document.getElementById('selectFile').addEventListener('click', function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    
    input.onchange = async function(e) {
      const file = e.target.files[0];
      if (file.size > 50 * 1024 * 1024) {
        alert(chrome.i18n.getMessage('errorSizeExceeded'));
        return;
      }
      
      const url = URL.createObjectURL(file);
      wavesurfer.load(url);

      // 同时加载到 AudioBuffer 中
      try {
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.error('Error loading audio file:', err);
        alert(chrome.i18n.getMessage('errorLoadFailed'));
      }
    };
    
    input.click();
  });

  // 播放按钮
  document.getElementById('playBtn').addEventListener('click', function() {
    // 获取当前选中的区域
    const regionsPlugin = wavesurfer.plugins.find(plugin => plugin instanceof WaveSurfer.Regions);
    const regions = regionsPlugin ? regionsPlugin.getRegions() : [];
    const region = regions[0];
    
    if (region) {
      // 如果有选中区域，则播放选中区域
      wavesurfer.play(region.start, region.end);
      
      // 当播放到区域结束时停止
      const checkEnd = () => {
        if (wavesurfer.getCurrentTime() >= region.end) {
          wavesurfer.pause();
          wavesurfer.un('audioprocess', checkEnd);
        }
      };
      wavesurfer.on('audioprocess', checkEnd);
    } else {
      // 如果没有选中区域，则播放整个音频
      wavesurfer.play();
    }
  });

  // 停止按钮
  document.getElementById('stopBtn').addEventListener('click', function() {
    wavesurfer.pause();
    // 移除可能存在的结束检查事件监听
    wavesurfer.un('audioprocess');
  });

  // 更新时间显示
  wavesurfer.on('audioprocess', function() {
    document.getElementById('currentTime').textContent = 
      wavesurfer.getCurrentTime().toFixed(2) + 's';
  });

  // 修改 ready 事件处理
  wavesurfer.on('ready', function() {
    const duration = wavesurfer.getDuration();
    // 获取 regions 插件实例
    const regionsPlugin = wavesurfer.plugins.find(plugin => plugin instanceof WaveSurfer.Regions);
    
    if (regionsPlugin) {
      regionsPlugin.addRegion({
        id: 'region1',
        start: 0,
        end: duration / 2,
        color: 'rgba(93, 78, 140, 0.3)',
        drag: true,
        resize: true
      });
    }
  });

  // 添加使用统计
  let clipCount = 0;
  document.getElementById('clipDownloadBtn').addEventListener('click', async function() {
    const regionsPlugin = wavesurfer.plugins.find(plugin => plugin instanceof WaveSurfer.Regions);
    const regions = regionsPlugin ? regionsPlugin.getRegions() : [];
    const region = regions[0];
    
    if (!region) {
      alert(chrome.i18n.getMessage('errorSelectRegion'));
      return;
    }

    if (!audioBuffer) {
      alert(chrome.i18n.getMessage('errorLoadAudio'));
      return;
    }

    try {
      // 创建新的 AudioBuffer 用于存储裁剪后的音频
      const startSample = Math.floor(region.start * audioBuffer.sampleRate);
      const endSample = Math.floor(region.end * audioBuffer.sampleRate);
      const duration = region.end - region.start;
      
      const clippedBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        Math.floor(duration * audioBuffer.sampleRate),
        audioBuffer.sampleRate
      );

      // 复制选中区域的音频数据
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const originalData = audioBuffer.getChannelData(channel);
        const newData = clippedBuffer.getChannelData(channel);
        
        for (let i = 0; i < newData.length; i++) {
          newData[i] = originalData[i + startSample];
        }
      }

      // 将 AudioBuffer 转换为 WAV 格式
      const wavData = audioBufferToWav(clippedBuffer);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      
      // 创建下载链接
      const downloadUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = downloadUrl;
      downloadLink.download = 'clipped_audio.wav';
      
      // 触发下载
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(downloadUrl);

      clipCount++;
      // 可以保存到 localStorage
      localStorage.setItem('clipCount', clipCount);

    } catch (err) {
      console.error('Error clipping audio:', err);
      alert(chrome.i18n.getMessage('errorClipFailed'));
    }
  });
});

// AudioBuffer 转 WAV 格式的函数
function audioBufferToWav(buffer) {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  let result;
  if (numberOfChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  return encodeWAV(result, format, sampleRate, numberOfChannels, bitDepth);
}

function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  
  return result;
}

function encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  // WAV 文件头
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  // 写入采样数据
  floatTo16BitPCM(view, 44, samples);

  return buffer;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

// 添加全局错误处理
window.onerror = function(message, source, lineno, colno, error) {
  console.error('Error: ', message);
  // 可以添加用户友好的错误提示
}; 