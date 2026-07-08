/**
 * Enhanced Utilities for Check-in System
 * ============================================
 * ฟังก์ชันเสริมสำหรับเพิ่มความเสถียรและ UX ของระบบเช็คอิน
 * 
 * ฟังก์ชันที่เพิ่มเติม:
 * 1. Browser Detection - ตรวจสอบว่าเปิดผ่าน Browser ภายนอกหรือ In-App Browser
 * 2. Internet Connectivity - ตรวจสอบการเชื่อมต่อ Internet
 * 3. GPS Permission Check - ตรวจสอบสิทธิ์การเข้าถึง GPS
 * 4. Timeout Wrapper - ห่อ Promise ด้วย Timeout
 * 5. GPS Multi-Read Selector - เลือกค่า GPS ที่ดีที่สุดจาก 5 ครั้ง
 * 6. Error Normalizer - รวม Error messages เป็นรูปแบบเดียวกัน
 */

(function () {
  // ============================================
  // 1. BROWSER DETECTION
  // ============================================

  function detectBrowserType() {
    const ua = navigator.userAgent.toLowerCase();

    // ตรวจสอบ LINE Browser / In-App Browser
    const isLineApp = ua.includes('line');
    const isLineWebview = ua.includes('liff') || ua.includes('line/');
    const isFacebookApp = ua.includes('fban') || ua.includes('fbav');
    const isInstagramApp = ua.includes('instagram');
    const isTwitterApp = ua.includes('twitter');
    const isWeChatApp = ua.includes('micromessenger');

    // ตรวจสอบ Native Browser
    const isChrome = ua.includes('chrome') && !ua.includes('chromium');
    const isSafari = ua.includes('safari') && !ua.includes('chrome');
    const isFirefox = ua.includes('firefox');
    const isEdge = ua.includes('edg');

    return {
      isLineApp: isLineApp || isLineWebview,
      isFacebookApp,
      isInstagramApp,
      isTwitterApp,
      isWeChatApp,
      isInAppBrowser: isLineApp || isLineWebview || isFacebookApp || isInstagramApp || isTwitterApp || isWeChatApp,
      isChrome,
      isSafari,
      isFirefox,
      isEdge,
      isNativeBrowser: isChrome || isSafari || isFirefox || isEdge,
      userAgent: ua,
    };
  }

  function isAllowedBrowser() {
    const browser = detectBrowserType();
    return browser.isNativeBrowser && !browser.isInAppBrowser;
  }

  function getBrowserWarningMessage() {
    const browser = detectBrowserType();

    if (browser.isLineApp) {
      return {
        title: '⚠️ ต้องเปิดผ่าน Browser ภายนอก',
        message: 'ระบบเช็คอินต้องการเปิดผ่าน Chrome, Safari หรือ Browser อื่นๆ ไม่ใช่ LINE In-App Browser',
        instruction: 'กรุณาคัดลอก URL นี้ แล้วเปิดใน Chrome หรือ Safari',
        appName: 'LINE',
      };
    }

    if (browser.isFacebookApp) {
      return {
        title: '⚠️ ต้องเปิดผ่าน Browser ภายนอก',
        message: 'ระบบเช็คอินต้องการเปิดผ่าน Chrome, Safari หรือ Browser อื่นๆ ไม่ใช่ Facebook In-App Browser',
        instruction: 'กรุณาคัดลอก URL นี้ แล้วเปิดใน Chrome หรือ Safari',
        appName: 'Facebook',
      };
    }

    if (browser.isInstagramApp) {
      return {
        title: '⚠️ ต้องเปิดผ่าน Browser ภายนอก',
        message: 'ระบบเช็คอินต้องการเปิดผ่าน Chrome, Safari หรือ Browser อื่นๆ ไม่ใช่ Instagram In-App Browser',
        instruction: 'กรุณาคัดลอก URL นี้ แล้วเปิดใน Chrome หรือ Safari',
        appName: 'Instagram',
      };
    }

    if (browser.isWeChatApp) {
      return {
        title: '⚠️ ต้องเปิดผ่าน Browser ภายนอก',
        message: 'ระบบเช็คอินต้องการเปิดผ่าน Chrome, Safari หรือ Browser อื่นๆ ไม่ใช่ WeChat In-App Browser',
        instruction: 'กรุณาคัดลอก URL นี้ แล้วเปิดใน Chrome หรือ Safari',
        appName: 'WeChat',
      };
    }

    return null;
  }

  // ============================================
  // 2. INTERNET CONNECTIVITY CHECK
  // ============================================

  async function checkInternetConnectivity(timeoutMs = 5000) {
    try {
      // ใช้ fetch เพื่อตรวจสอบการเชื่อมต่อ
      // ลองเรียก API ที่เล็กที่สุด (ไม่ใช้ Google Apps Script เพราะอาจช้า)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch('https://www.google.com/favicon.ico', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return true;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          return false; // Timeout
        }
        return false;
      }
    } catch (err) {
      return false;
    }
  }

  // ============================================
  // 3. GPS PERMISSION CHECK
  // ============================================

  async function checkGPSPermission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) {
        // Browser ไม่รองรับ Permissions API
        return { status: 'unknown', message: 'Browser ไม่รองรับการตรวจสอบสิทธิ์' };
      }

      const result = await navigator.permissions.query({ name: 'geolocation' });

      if (result.state === 'granted') {
        return { status: 'granted', message: 'สิทธิ์ GPS ได้รับการอนุมัติแล้ว' };
      }

      if (result.state === 'denied') {
        return {
          status: 'denied',
          message: 'สิทธิ์ GPS ถูกปฏิเสธ',
          instruction: 'กรุณาเปิดสิทธิ์ GPS ในการตั้งค่า > ความเป็นส่วนตัว > ตำแหน่ง',
        };
      }

      if (result.state === 'prompt') {
        return { status: 'prompt', message: 'ระบบจะขอสิทธิ์ GPS เมื่อเริ่มอ่านตำแหน่ง' };
      }

      return { status: 'unknown', message: 'ไม่สามารถตรวจสอบสิทธิ์ GPS' };
    } catch (err) {
      return { status: 'unknown', message: 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์ GPS' };
    }
  }

  // ============================================
  // 4. TIMEOUT WRAPPER
  // ============================================

  function withTimeout(promise, timeoutMs, timeoutMessage = 'หมดเวลาการร้องขอ') {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      // ✅ เพิ่มบรรทัดนี้: ทำลายนาฬิกาจับเวลาทิ้งทันทีเมื่องานเสร็จสิ้น
      clearTimeout(timeoutId);
    });
  }

  // ============================================
  // 5. GPS MULTI-READ SELECTOR
  // ============================================

  /**
   * อ่าน GPS 5 ครั้ง แล้วเลือกค่าที่ดีที่สุด
   * เลือกตามลำดับความสำคัญ:
   * 1. ระยะห่างจากจุดศูนย์กลางพื้นที่ (distanceCenter) น้อยที่สุด
   * 2. ถ้าเท่ากัน ให้เลือก accuracy ต่ำกว่า
   */
  function selectBestGPSReading(readings, centerLat, centerLng) {
    if (!readings || readings.length === 0) {
      return null;
    }

    // คำนวณระยะห่างจากจุดศูนย์กลาง
    const readingsWithDistance = readings.map((reading) => {
      const distance = calculateHaversineDistance(
        reading.lat,
        reading.lng,
        centerLat,
        centerLng,
      );
      return {
        ...reading,
        distanceCenter: distance,
      };
    });

    // เรียงตามระยะห่างจากศูนย์กลาง (น้อยที่สุดขึ้นไป)
    readingsWithDistance.sort((a, b) => {
      if (a.distanceCenter !== b.distanceCenter) {
        return a.distanceCenter - b.distanceCenter;
      }
      // ถ้าระยะห่างเท่ากัน ให้เลือก accuracy ต่ำกว่า
      return a.accuracy - b.accuracy;
    });

    return readingsWithDistance[0];
  }

  /**
   * Haversine Formula - คำนวณระยะห่างระหว่าง 2 จุด (เมตร)
   */
  function calculateHaversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // รัศมีโลก (เมตร)
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * อ่าน GPS แบบ Multi-Read (5 ครั้ง)
   * @param {number} readCount - จำนวนครั้งที่ต้องอ่าน (default: 5)
   * @param {number} intervalMs - ช่วงเวลาระหว่างการอ่าน (default: 1000ms)
   * @param {number} timeoutMs - Timeout รวม (default: 20000ms)
   * @param {function} onProgress - Callback เมื่อมีการอ่านค่าใหม่
   */
  // ⏱️ TIMEOUT/POLLING MANAGEMENT (ปรับให้เหมือนระบบต้นแบบ farmchokchai_checkin):
  // รวมจุด clearWatch/clearTimeout ไว้ที่เดียว (เทียบเท่า clearAppTimeout ของ Checkin) เพื่อ
  // ให้แน่ใจว่าไม่มี watchPosition หรือ setTimeout ค้างอยู่เบื้องหลังไม่ว่าจะจบด้วยเหตุผลใด
  // (ครบจำนวนที่อ่าน, error, timeout, หรือถูกยกเลิกจากภายนอกตอน retry/ออกจากหน้า)
  // cancelToken (ไม่บังคับ) คือ object ว่างที่ผู้เรียกส่งเข้ามา ฟังก์ชันนี้จะเติม .cancel ให้
  // เพื่อให้ผู้เรียกสามารถสั่งหยุดการอ่าน GPS และเคลียร์ Timer ได้ทันทีจากภายนอก
  async function readGPSMultiple(
    readCount = 5,
    intervalMs = 1000,
    timeoutMs = 20000,
    onProgress = null,
    cancelToken = null,
  ) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('อุปกรณ์ไม่รองรับ GPS'));
        return;
      }

      const readings = [];
      let readingsCollected = 0;
      let watchId = null;
      let timeoutId = null;
      let settled = false;

      // ✅ เปลี่ยนจาก Date.now() เป็น 0 เพื่อให้ระบบเก็บ GPS ค่าแรกสุดทันที ไม่ต้องรอ 1 วินาที
      let lastAcceptedAt = 0;

      // 🟢 จุดเดียวที่หยุด Polling (clearWatch) และ Timer (clearTimeout) ทั้งหมดทันที
      function stopPolling() {
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (cancelToken) cancelToken.cancel = null;
      }

      // 🟢 ให้ผู้เรียกภายนอก (เช่น onUnmounted หรือ Master Timeout) สั่งยกเลิกได้ทันที
      if (cancelToken) {
        cancelToken.cancel = function (reason) {
          if (settled) return;
          settled = true;
          stopPolling();
          reject(new Error(reason || 'ยกเลิกการอ่าน GPS'));
        };
      }

      // Set timeout รวม (ถ้า timeoutMs เป็น 0/undefined = ไม่ตั้ง Deadline เลย รอจนกว่าจะได้ครบจำนวนที่กำหนด)
      if (Number(timeoutMs) > 0) {
        timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          stopPolling();
          // ✅ เปิด Reject กลับมา เพื่อให้ Error ชัดเจนถ้าหาไม่ครบ 5 ครั้งจริงๆ
          reject(new Error(`หมดเวลาการอ่าน GPS (ไม่สามารถอ่านครบ ${readCount} ครั้งในเวลาที่กำหนด)`));
        }, timeoutMs);
      }

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (settled) return;
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          if (onProgress) {
            onProgress({
              lat,
              lng,
              accuracy,
              count: readingsCollected + 1,
              total: readCount,
            });
          }

          if (readingsCollected >= readCount) {
            return;
          }

          const now = Date.now();
          if (now - lastAcceptedAt < intervalMs) {
            return;
          }
          lastAcceptedAt = now;

          readings.push({ lat, lng, accuracy });
          readingsCollected++;

          if (readingsCollected >= readCount) {
            settled = true;
            stopPolling(); // ปิด Polling และนาฬิกาภายในเมื่อครบจำนวนที่กำหนด
            resolve(readings);
          }
        },
        (err) => {
          if (settled) return;
          settled = true;
          stopPolling();

          let message = 'เกิดข้อผิดพลาด GPS';
          if (err.code === 1) {
            message = 'ถูกปฏิเสธสิทธิ์การเข้าถึงตำแหน่ง';
          } else if (err.code === 2) {
            message = 'ไม่สามารถระบุตำแหน่งได้';
          } else if (err.code === 3) {
            message = 'หมดเวลาการขอตำแหน่ง';
          }
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          // ⏱️ ไม่ตั้ง timeout ให้ watchPosition (ปล่อยเป็นค่า default = Infinity ตาม spec)
          // เพื่อไม่ให้เบราว์เซอร์ยิง error "หมดเวลาการขอตำแหน่ง" เองถ้าไม่มีสัญญาณ GPS ชั่วคราว
          maximumAge: 0,
        },
      );
    });
  }

  // ============================================
  // 6. ERROR NORMALIZER
  // ============================================

  function normalizeError(err, context = '') {
    if (!err) {
      return {
        type: 'unknown',
        title: 'เกิดข้อผิดพลาด',
        message: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
        context,
        originalError: null,
      };
    }

    const message = String(err?.message || err?.toString() || '').toLowerCase();
    const code = err?.code;

    // GPS Errors
    if (message.includes('gps') || message.includes('geolocation') || message.includes('location')) {
      if (message.includes('denied') || message.includes('permission')) {
        return {
          type: 'gps_permission_denied',
          title: 'ไม่ได้รับสิทธิ์ GPS',
          message: 'กรุณาเปิดสิทธิ์ GPS ในการตั้งค่า > ความเป็นส่วนตัว > ตำแหน่ง',
          context,
          originalError: err,
        };
      }
      if (message.includes('timeout')) {
        return {
          type: 'gps_timeout',
          title: 'หมดเวลาการอ่าน GPS',
          message: 'ไม่สามารถระบุตำแหน่งได้ในเวลาที่กำหนด กรุณาตรวจสอบสัญญาณ GPS และลองใหม่',
          context,
          originalError: err,
        };
      }
      return {
        type: 'gps_error',
        title: 'เกิดข้อผิดพลาด GPS',
        message: err?.message || 'ไม่สามารถระบุตำแหน่งได้',
        context,
        originalError: err,
      };
    }

    // Network/Internet Errors
    if (message.includes('network') || message.includes('offline') || message.includes('internet')) {
      return {
        type: 'network_error',
        title: 'ปัญหาการเชื่อมต่อ',
        message: 'ตรวจสอบการเชื่อมต่อ Internet และลองใหม่',
        context,
        originalError: err,
      };
    }

    // Timeout Errors
    if (message.includes('timeout') || message.includes('หมดเวลา')) {
      return {
        type: 'timeout_error',
        title: 'หมดเวลาการร้องขอ',
        message: 'การร้องขอใช้เวลานานเกินไป กรุณาตรวจสอบการเชื่อมต่อและลองใหม่',
        context,
        originalError: err,
      };
    }

    // Firebase/Auth Errors
    if (message.includes('firebase') || message.includes('auth') || message.includes('token')) {
      if (message.includes('revoked') || message.includes('unauthorized')) {
        return {
          type: 'auth_error',
          title: 'ปัญหาการยืนยันตัวตน',
          message: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
          context,
          originalError: err,
        };
      }
      return {
        type: 'firebase_error',
        title: 'เกิดข้อผิดพลาด Firebase',
        message: err?.message || 'ไม่สามารถเชื่อมต่อกับ Firebase ได้',
        context,
        originalError: err,
      };
    }

    // Server/API Errors
    if (message.includes('server') || message.includes('api') || message.includes('script')) {
      if (code === 403 || code === 401 || message.includes('forbidden') || message.includes('unauthorized')) {
        return {
          type: 'server_auth_error',
          title: 'ไม่มีสิทธิ์เข้าถึง',
          message: 'กรุณาตรวจสอบการตั้งค่า Google Apps Script',
          context,
          originalError: err,
        };
      }
      return {
        type: 'server_error',
        title: 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์',
        message: err?.message || 'ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้',
        context,
        originalError: err,
      };
    }

    // Geofence Errors
    if (message.includes('geofence') || message.includes('boundary') || message.includes('area')) {
      return {
        type: 'geofence_error',
        title: 'อยู่นอกพื้นที่ที่กำหนด',
        message: err?.message || 'กรุณาเข้าไปในพื้นที่แล้วลองใหม่',
        context,
        originalError: err,
      };
    }

    // Default
    return {
      type: 'generic_error',
      title: 'เกิดข้อผิดพลาด',
      message: err?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
      context,
      originalError: err,
    };
  }

  // ============================================
  // EXPORT
  // ============================================

  window.EnhancedUtils = {
    // Browser Detection
    detectBrowserType,
    isAllowedBrowser,
    getBrowserWarningMessage,

    // Internet Connectivity
    checkInternetConnectivity,

    // GPS Permission
    checkGPSPermission,

    // Timeout Wrapper
    withTimeout,

    // GPS Multi-Read
    selectBestGPSReading,
    calculateHaversineDistance,
    readGPSMultiple,

    // Error Normalizer
    normalizeError,
  };
})();
