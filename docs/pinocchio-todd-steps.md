# Bring these

- [ ] Piano USB cable with a USB-B connector.
- [ ] USB hub and its power adapter.
- [ ] Home Wi-Fi password.
- [ ] A pen.

## 1. Unbox and power on

- [ ] Put Pinocchio on a flat surface with space around it for ventilation.
- [ ] Connect the power cable to the Mac mini and a power outlet.
- [ ] Connect a keyboard, mouse, and monitor. Use HDMI or a suitable USB-C display adapter, depending on the ports on your model.
- [ ] Press the power button at the back; there is no front power button.

## 2. Ports and USB hub

- [ ] Count the USB-C ports on your model; the Mac mini has only a few. Plug the USB hub into one.
- [ ] Connect the hub’s power adapter if it needs one.
- [ ] Plug the keyboard and mouse into the hub. Use the hub for the piano connection too.

## 3. Piano cable

- [ ] Find the Roland FP-30X port marked **Computer**. It is USB-B: the squarish connector.
- [ ] Connect a USB-B cable from that port to a USB-C or USB-A port on the hub. Do **not** use the piano’s port for a USB memory stick.

## 4. Wi-Fi

- [ ] Join your home Wi-Fi network during setup, using your Wi-Fi password.
- [ ] Use Ethernet instead if a cable connection to your router is available. Ethernet is better for a reliable connection.

## 5. Setup Assistant

- [ ] Choose your language and country.
- [ ] Select your home network if setup asks for Wi-Fi.
- [ ] At the information-transfer screen, choose **Don’t transfer any information now**, or **Not Now** if that is the option shown.
- [ ] At **Apple Account** (Sonoma: **Apple ID**), choose **Set Up Later**. Skipping this is OK.
- [ ] Create your computer account and write down the **FULL NAME** on paper.
- [ ] Write down the **ACCOUNT NAME**, also called the short name. Orolo will use this name to log in.
- [ ] Choose a **PASSWORD** and write it on paper only. Never write the password into any file.
- [ ] Give Orolo the full name, account name, and password through the channel you normally use.
- [ ] Decline analytics sharing.
- [ ] Skip Siri and Screen Time.
- [ ] Skip Touch ID unless you want to set it up and have a compatible keyboard. Touch ID is optional.
- [ ] If setup offers FileVault disk encryption, leave it off for now.

## 6. Wait for the desktop

- [ ] Wait until the desktop appears. Setup can take several minutes.
- [ ] Click the Apple logo at the top left, then **System Settings → General → About**. Set **Name** to **Pinocchio**.

## 7. Turn on Remote Login

- [ ] Click the Apple logo at the top left, then **System Settings**. In the sidebar, click **General**, then **Sharing**.
- [ ] Turn **Remote Login** on. Enter your computer-account password if requested.
- [ ] Click the information button beside **Remote Login** to open its settings.
- [ ] Under **Allow access for**, make sure your account is included. **All users** is also acceptable.
- [ ] Find the line resembling `ssh youraccount@Pinocchio.local`. Write down the exact line shown and give it to Orolo.

## 8. Read the IP address

- [ ] Open **System Settings → Wi-Fi**. Click **Details** beside your connected network.
- [ ] Write down the **IP address** and give it to Orolo. Prefer the `.local` name from Remote Login because the IP address can change.
- [ ] If you connected using Ethernet, open **System Settings → Network → Ethernet → Details → TCP/IP** instead. Write down its IP address.

## 9. Prevent sleep

- [ ] Open **System Settings → Energy** (Sonoma: **Energy Saver**).
- [ ] Turn on **Prevent automatic sleeping when the display is off**.
- [ ] Turn on **Start up automatically after a power failure**.
- [ ] Turn on **Wake for network access** if offered.
- [ ] Set **Low Power Mode** to **Off** or **Never**, depending on the control shown, if available.

## 10. Automatic login

- [ ] Automatic login is recommended for this home music room, but it lowers security. Anyone with physical access can enter your account after startup.
- [ ] Open **System Settings → Privacy & Security → FileVault**. Leave FileVault off for now; automatic login requires it to be off.
- [ ] Open **System Settings → Users & Groups**. Set **Automatically log in as** to your account; open **Login Options** first if that appears on your version.
- [ ] Enter your computer-account password if requested.

## 11. Software updates

- [ ] Open **System Settings → General → Software Update**.
- [ ] Install pending updates and let the Mac restart. Finish this before Orolo starts working.
- [ ] After restarting, wait for the desktop. Log in if asked.

## 12. Plug in the FP-30X

- [ ] Confirm the piano’s **Computer** port is connected to the USB hub, then turn the piano on.
- [ ] Leave **Local Control ON**, the same as in the Windows checklist.
- [ ] Tell Orolo that the FP-30X is plugged in and turned on.

## 13. First MidiTutor launch

- [ ] When Orolo has installed MidiTutor, open it when instructed. The app is not signed by Apple, so macOS may block its first launch.
- [ ] If macOS says it cannot check MidiTutor for malicious software, dismiss the message. On Sequoia, the right-click **Open** shortcut no longer bypasses this block.
- [ ] Open **System Settings → Privacy & Security**. Scroll down to the message about MidiTutor and click **Open Anyway**.
- [ ] Enter your computer-account password and click **Open** if asked.
- [ ] Orolo may start MidiTutor remotely over SSH. If a prompt appears on your screen, click the appropriate button described above.

## 14. Permission prompts

- [ ] If MidiTutor asks to use MIDI or devices, click **Allow**.
- [ ] If it asks for **Input Monitoring** or **Accessibility**, click **Don’t Allow** and tell Orolo.
- [ ] Whether these permission prompts appear is **NOT VERIFIED**. Tell Orolo about any different prompt before approving it.

## 15. Done when

- [ ] **Remote Login** is on.
- [ ] You have the exact `ssh` line and IP address written down and have given them to Orolo.
- [ ] The piano is connected through the hub and turned on.
- [ ] You have given Orolo your account name and password through your usual channel. The password is not stored in any file.

Verified: no steps have been done on this machine yet. Menu names are from macOS Sequoia and are NOT VERIFIED on this machine.
