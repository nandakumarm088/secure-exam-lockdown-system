// LockdownHelper\LockdownHelper.cpp

#include <windows.h>
#include <thread>
#include <atomic>
#include <string>
#include <Lmcons.h>
#include <tlhelp32.h>
#include <fstream>
#include <sstream>
#include <vector>

// ==== CONFIGURE THIS TO MATCH YOUR CLIENT APP ====
const wchar_t* CLIENT_EXE_NAME = L"SecureExam Client.exe"; // Set to your EXE name as seen in Task Manager

HHOOK keyboardHook = nullptr;
std::atomic<bool> lockdownEnabled(false);
HANDLE hPipe = INVALID_HANDLE_VALUE;
std::atomic<bool> shutdownRequested(false);

// Logging utility
void WriteLog(const std::wstring& msg) {
    std::wofstream log(L"LockdownHelper.log", std::ios::app);
    if (log) log << msg << std::endl;
}

// Returns true if processName is running (case-insensitive), checks all processes
bool IsProcessRunning(const wchar_t* processName) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return false;
    PROCESSENTRY32W entry;
    entry.dwSize = sizeof(entry);
    bool found = false;
    if (Process32FirstW(snapshot, &entry)) {
        do {
            if (_wcsicmp(entry.szExeFile, processName) == 0) {
                found = true;
                break;
            }
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return found;
}

// Only one helper allowed, even as subprocess
bool IsDuplicateLockdownHelper() {
    DWORD currentPID = GetCurrentProcessId();
    int count = 0;
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return false;

    PROCESSENTRY32W entry;
    entry.dwSize = sizeof(entry);

    if (Process32FirstW(snapshot, &entry)) {
        do {
            if (_wcsicmp(entry.szExeFile, L"LockdownHelper.exe") == 0) {
                if (entry.th32ProcessID != currentPID) {
                    // Another instance found
                    CloseHandle(snapshot);
                    return true;
                }
            }
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);
    return false;
}

std::wstring GetUsername() {
    wchar_t username[UNLEN + 1]{};
    DWORD username_len = UNLEN + 1;
    if (!GetUserNameW(username, &username_len))
        return L"user";
    return username;
}

// Safer command parsing: handle multiple commands in one read (delimiter '\n' or '\r\n')
std::vector<std::string> SplitCommands(const std::string& buffer) {
    std::vector<std::string> commands;
    std::istringstream iss(buffer);
    std::string line;
    while (std::getline(iss, line)) {
        if (!line.empty())
            commands.push_back(line);
    }
    return commands;
}

LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && lockdownEnabled.load()) {
        KBDLLHOOKSTRUCT* p = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        bool keyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
        int vk = p->vkCode;
        if (keyDown) {
            switch (vk) {
                case VK_TAB:
                case VK_ESCAPE:
                case VK_F4:
                    if (GetAsyncKeyState(VK_MENU) & 0x8000 || GetAsyncKeyState(VK_CONTROL) & 0x8000)
                        return 1;
                    break;
                case 'W': case 'T': case 'N': case 'Q':
                    if (GetAsyncKeyState(VK_CONTROL) & 0x8000)
                        return 1;
                    break;
                case VK_SPACE:
                    if (GetAsyncKeyState(VK_MENU) & 0x8000)
                        return 1;
                    break;
                case 'D': case 'M':
                    if (GetAsyncKeyState(VK_LWIN) & 0x8000 || GetAsyncKeyState(VK_RWIN) & 0x8000)
                        return 1;
                    break;
                case VK_LWIN: case VK_RWIN:
                    return 1;
                default:
                    if (vk >= VK_F1 && vk <= VK_F12)
                        return 1;
            }
        }
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

void SetHook() {
    if (!keyboardHook) {
        keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, LowLevelKeyboardProc, NULL, 0);
        if (!keyboardHook) {
            WriteLog(L"Failed to install keyboard hook.");
            MessageBoxW(NULL, L"Failed to install keyboard hook", L"LockdownHelper", MB_OK | MB_ICONERROR);
        } else {
            WriteLog(L"Keyboard hook installed successfully.");
        }
    }
}

void RemoveHook() {
    if (keyboardHook) {
        UnhookWindowsHookEx(keyboardHook);
        keyboardHook = nullptr;
        WriteLog(L"Keyboard hook removed.");
    }
}

// Monitor client process and exit if client is closed
void MonitorClientAndShutdown() {
    while (!shutdownRequested.load()) {
        if (!IsProcessRunning(CLIENT_EXE_NAME)) {
            WriteLog(L"Client process exited. Helper auto-exiting.");
            shutdownRequested = true;
            // Send a WM_QUIT to the message loop if needed
            PostQuitMessage(0);
            break;
        }
        Sleep(2000);
    }
}

// Pipe listener function (runs on background thread)
void PipeListenerThread() {
    std::wstring username = GetUsername();
    std::wstring pipeName = L"\\\\.\\pipe\\LockdownPipe_" + username;
    while (!shutdownRequested.load()) {
        hPipe = CreateNamedPipeW(
            pipeName.c_str(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1, 1024, 1024,
            0, NULL
        );

        if (hPipe == INVALID_HANDLE_VALUE) {
            WriteLog(L"CreateNamedPipe failed.");
            Sleep(2000);
            continue;
        }

        // Wait for a client (main app) to connect
        BOOL connected = ConnectNamedPipe(hPipe, NULL) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);
        if (!connected) {
            CloseHandle(hPipe);
            hPipe = INVALID_HANDLE_VALUE;
            continue;
        }
        WriteLog(L"Pipe connected.");

        char buffer[256];
        DWORD bytesRead = 0;

        while (!shutdownRequested.load() && ReadFile(hPipe, buffer, sizeof(buffer) - 1, &bytesRead, NULL) && bytesRead > 0) {
            buffer[bytesRead] = '\0';
            std::string incoming(buffer);

            // Parse and execute every command found
            for (const std::string& command : SplitCommands(incoming)) {
                if (command.find("lockdown_on") != std::string::npos) {
                    lockdownEnabled = true;
                    WriteLog(L"Lockdown enabled.");
                }
                else if (command.find("lockdown_off") != std::string::npos) {
                    lockdownEnabled = false;
                    WriteLog(L"Lockdown disabled.");
                }
                else if (command.find("shutdown") != std::string::npos) {
                    WriteLog(L"Shutdown requested by main app.");
                    shutdownRequested = true;
                    PostQuitMessage(0); // Tell Windows message loop to end
                }
                else {
                    std::wstring wcommand(command.begin(), command.end());
                    WriteLog(L"Received unrecognized command: " + wcommand);
                }
            }
        }

        if (!shutdownRequested.load()) {
            WriteLog(L"Pipe client disconnected or ReadFile error, retrying.");
            Sleep(1000); // Prevent tight reconnect loop
        }

        DisconnectNamedPipe(hPipe);
        CloseHandle(hPipe);
        hPipe = INVALID_HANDLE_VALUE;
    }
    WriteLog(L"Pipe listener thread exiting.");
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    WriteLog(L"LockdownHelper starting up...");

    // Allow only one helper process at a time
    if (IsDuplicateLockdownHelper()) {
        WriteLog(L"Another instance of LockdownHelper is already running. Exiting.");
        return 0;
    }

    // Only run if client process is running
    if (!IsProcessRunning(CLIENT_EXE_NAME)) {
        WriteLog(L"Client process is not running. Exiting LockdownHelper.");
        return 0;
    }

    SetHook();

    // Launch threads: pipe listener and client monitor
    std::thread pipeThread(PipeListenerThread);
    std::thread clientWatchThread(MonitorClientAndShutdown);

    while (true) {
        // Break if shutdown
        if (shutdownRequested.load()) break;
        // Wait for a message for up to 500ms
        MSG msg;
        BOOL result = PeekMessage(&msg, NULL, 0, 0, PM_REMOVE);
        if (result) {
            if (msg.message == WM_QUIT) {
                WriteLog(L"Got WM_QUIT in PeekMessage, breaking message loop.");
                break;
            }
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    shutdownRequested = true;
    if (pipeThread.joinable()) pipeThread.join();
    if (clientWatchThread.joinable()) clientWatchThread.join();

    RemoveHook();
    WriteLog(L"LockdownHelper shutting down.");
    return 0;
}
