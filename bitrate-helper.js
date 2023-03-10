const MIN_VP9_SPATIAL_LAYER_LONG_SIDE_LENGTH = 240;
const MIN_VP9_SPATIAL_LAYER_SHORT_SIDE_LENGTH = 135;

function getVideoCodec(mimeType) {
  if (!mimeType) {
    return "VP8";
  }
  return mimeType.split("/")[1];
}

function getMaxVideoEncodings({ width, height, codec }) {
  switch (codec) {
    case "VP9":
      return maxVideoEncodingsForVP9({ width, height });
    case "VP8":
    default:
      return maxVideoEncodingsForVP8({ width, height });
  }
}

// Gets limited number of layers for given resolution.
function maxVideoEncodingsForVP9({ width, height }) {
  if (!width || !height) {
    return 1;
  }
  const isLandscape = width >= height;
  const minWidth = isLandscape
    ? MIN_VP9_SPATIAL_LAYER_LONG_SIDE_LENGTH
    : MIN_VP9_SPATIAL_LAYER_SHORT_SIDE_LENGTH;
  const minHeight = isLandscape
    ? MIN_VP9_SPATIAL_LAYER_SHORT_SIDE_LENGTH
    : MIN_VP9_SPATIAL_LAYER_LONG_SIDE_LENGTH;
  const numLayersFitHorz = Math.floor(
    1 + Math.max(0.0, Math.log2(width / minWidth))
  );
  const numLayersFitVert = Math.floor(
    1 + Math.max(0.0, Math.log2(height / minHeight))
  );
  return Math.min(numLayersFitHorz, numLayersFitVert);
}

function maxVideoEncodingsForVP8({ width, height }) {
  // libwebrtc limits the max encodings number
  // https://chromium.googlesource.com/external/webrtc/+/master/media/engine/simulcast.cc#90
  if (!width || !height) {
    return 1;
  }
  const [minSize, maxSize] = width > height ? [height, width] : [width, height];
  if (maxSize < 480 || minSize < 270) {
    return 1;
  } else if (maxSize < 960 || minSize < 540) {
    return 2;
  }
  return 3;
}

function scaleFactor(width, height, settingsWidth, settingsHeight) {
  let scaleFactor = 1.0;
  // If width = 0 we disable all the encodings (leaving maxVideoEncodings=0).
  if (width !== 0 && height !== 0) {
    // If width and height are not null, we want to apply a resolution scaling.
    // Otherwise, we let scaleFactor=1 and we calculate the number of maximum
    // video encodings using the video track width and height.
    if (width !== null && height !== null) {
      // The scaleFactor minimum value should be 1.
      // The maximum value is chosen to obtain a max level size of 72x72 pixels:
      //   max_level_width = settings.width / scaleFactor = 72
      //   max_level_height = settings.height / scaleFactor = 72
      //   => max_scaleFactor = min(settings.width / 72, settings.height / 72)
      scaleFactor = Math.min(
        Math.max(1, settingsWidth / width),
        Math.max(1, settingsHeight / height),
        settingsWidth / 72,
        settingsHeight / 72
      );
    }
  }
  return scaleFactor;
}

// This is the same logic libwebrtc applies internally.
// svc_config.cc:ConfigureSvcNormalVideo
function maxBitrateForSVC(width, height) {
  let totalBitrate = 0;
  // Limit number of layers for given resolution.
  const numSpatialLayers = maxVideoEncodingsForVP9({ width, height });
  const firstActiveLayer = 0;

  // Ensure top layer is even enough.
  const requiredDivisibility = 1 << (numSpatialLayers - firstActiveLayer - 1);

  width = width - (width % requiredDivisibility);
  height = height - (height % requiredDivisibility);

  // maxBitrate formula was derived from Google's internal
  // subjective-quality data to determing bit rates below which video
  // quality is unacceptable and above which additional bits do not provide
  // benefit. The formulas express rate in units of bps.
  const spatialLayers = [];
  for (let slIdx = 0; slIdx < numSpatialLayers; slIdx++) {
    const spatialLayer = {
      width: width >> (numSpatialLayers - slIdx - 1),
      height: height >> (numSpatialLayers - slIdx - 1),
      maxBitrate: 0,
    };
    const numPixels = spatialLayer.width * spatialLayer.height;
    spatialLayer.maxBitrate =
      (Math.floor((1.6 * numPixels) / 1000) + 50) * 1000;
    spatialLayers.push(spatialLayer);
  }
  totalBitrate = spatialLayers
    .map((sl) => sl.maxBitrate)
    .reduce((prev, curr) => prev + curr, 0);
  return totalBitrate;
}
