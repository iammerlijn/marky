// macOS: Quit from the Dock menu (and a quit from another app or at log out) sends `terminate:`
// to the app. tao has no `applicationShouldTerminate:`, so the app ends at once, without the
// unsaved-changes check of the windows. This adds that method to tao's app delegate. It cancels
// the terminate and starts the quit path of Cmd+Q. That path ends the app when the last window
// closes (tao then stops the event loop; it does not send `terminate:` again).
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, ffi, msg_send, sel};
use tauri::AppHandle;

static APP: OnceLock<AppHandle> = OnceLock::new();

// NSApplicationTerminateReply.
const NS_TERMINATE_CANCEL: usize = 0;

extern "C-unwind" fn should_terminate(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
    if let Some(app) = APP.get() {
        crate::quit(app);
    }
    NS_TERMINATE_CANCEL
}

pub fn install(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    unsafe {
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![ns_app, delegate];
        if delegate.is_null() {
            return;
        }
        let cls = ffi::object_getClass(delegate) as *mut AnyClass;
        let imp = std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize, Imp>(should_terminate);
        ffi::class_addMethod(cls, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
        // AppKit can keep what the delegate responds to from the time it was set. Set it again.
        let _: () = msg_send![ns_app, setDelegate: delegate];
    }
}

