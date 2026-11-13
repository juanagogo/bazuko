#pragma once
// La sesion de la cuenta del jugador: entra, crea cuenta, se renueva sola antes de vencer y se cierra.
// Los tokens de acceso e identidad viven solo en memoria; el de renovacion se guarda cifrado (SecureStore) para no pedir la
// contrasena cada vez. Cerrar sesion lo revoca en Cognito y borra el archivo. La contrasena nunca se guarda.
// Ademas, las gestiones de la cuenta (correo, contrasena, contrasena olvidada) van por su propio canal: Task().
// Todo es asincrono: se llama Update() cada cuadro y se miran State()/Error() y TaskState()/TaskError().
#include <filesystem>
#include <memory>
#include <string>

#include "online/Cognito.hpp"
#include "online/Social.hpp"

namespace Bazuko::Online {

class Session {
public:
    enum class State { SignedOut, Working, SignedIn };
    // Gestiones de la cuenta. Las de correo y contrasena piden sesion; las de contrasena olvidada, no.
    enum class Task { None, LoadUser, SetEmail, SendEmailCode, VerifyEmail, ChangePassword, ForgotPassword, ConfirmForgotPassword, SaveProfile, DeleteAccount };
    enum class TaskState { Idle, Working, Done, Failed };

    Session(CognitoConfig config, std::filesystem::path file);

    void Resume();   // al abrir el juego: si hay sesion guardada, la renueva en segundo plano
    void SignIn(const std::string& name, std::string password);
    void SignUp(const std::string& name, std::string password, const std::string& email);   // si sale bien, entra de una vez
    void SignOut();
    void Update(long long nowSeconds);   // termina lo pendiente y renueva el token 5 minutos antes de vencer

    // Correo: guardarlo lo deja sin verificar y manda el codigo de una vez; vacio lo quita (sin correo no hay recuperacion)
    void SetEmail(const std::string& email);
    void SendEmailCode();
    void VerifyEmail(const std::string& code);
    // Cambiar la contrasena cierra la cuenta en los demas equipos y vuelve a entrar en este con la nueva
    void ChangePassword(std::string oldPassword, std::string newPassword);
    // Contrasena olvidada: el codigo llega al correo verificado; al confirmarlo se entra con la nueva y se cierran los demas equipos
    void ForgotPassword(const std::string& name);
    void ConfirmForgotPassword(const std::string& name, const std::string& code, std::string newPassword);
    // Perfil en linea (GET/PUT /yo): se carga solo al entrar. La apariencia es el JSON plano del personaje ("" la quita)
    void SetAppearance(const std::string& appearanceJson);
    void SetFriendsOnly(bool friendsOnly);
    // Borra perfil, estadisticas y amistades en el servidor y luego la cuenta en Cognito; al terminar, la sesion queda cerrada
    void DeleteAccount();

    State GetState() const { return m_State; }
    bool Configured() const { return m_Config.Valid(); }
    const CognitoConfig& Config() const { return m_Config; }
    const std::string& Name() const { return m_Tokens.username; }
    const std::string& AccessToken() const { return m_Tokens.access; }   // solo para mandarlo a los servicios del juego por HTTPS
    AuthError Error() const { return m_Error; }
    void ClearError() { m_Error = AuthError::None; }

    Task CurrentTask() const { return m_Task; }
    TaskState GetTaskState() const { return m_TaskState; }
    AuthError TaskError() const { return m_TaskError; }
    void ClearTask() { if (m_TaskState != TaskState::Working) { m_Task = Task::None; m_TaskState = TaskState::Idle; m_TaskError = AuthError::None; } }
    bool UserLoaded() const { return m_UserLoaded; }
    const std::string& Email() const { return m_User.email; }   // de la propia cuenta: solo se muestra en su Perfil
    bool EmailVerified() const { return m_User.emailVerified; }
    bool ProfileLoaded() const { return m_ProfileLoaded; }
    const OwnProfile& Profile() const { return m_Profile; }
    bool ProfileOnline() const { return m_Config.ApiValid(); }

    // Solo para las capturas del lobby (BAZUKO_LOBBY_PANTALLA): muestra una cuenta sin tocar la red ni el archivo
    void PreviewSignedIn(const std::string& name, const std::string& email, bool verified, const OwnProfile* profile = nullptr);

private:
    enum class Step { None, Resume, SignIn, SignUp, Refresh, SignOutOthers };
    enum class TaskStep { None, LoadUser, LoadProfile, SetEmail, SendEmailCode, VerifyEmail, ChangePassword, GlobalSignOut, Forgot, ConfirmForgot, SaveProfile, DeleteMe, DeleteUser };
    void Begin(Step step, std::shared_ptr<HttpCall> call);
    void BeginTask(Task task, TaskStep step, std::shared_ptr<HttpCall> call);
    bool CanTask() const;   // con sesion y sin otra gestion en curso
    void Adopt(const Tokens& tokens);
    void Drop();   // olvida la sesion en memoria y en el equipo
    void UpdateTask();

    CognitoConfig m_Config;
    std::filesystem::path m_File;
    State m_State = State::SignedOut;
    Step m_Step = Step::None;
    std::shared_ptr<HttpCall> m_Call;
    Tokens m_Tokens;
    AuthError m_Error = AuthError::None;
    long long m_RetryAt = 0;   // sin internet al renovar: no se reintenta antes de esto
    std::string m_PendingName, m_PendingPassword;   // entre crear la cuenta (o cambiar la contrasena) y entrar con ella; se borra al terminar
    bool m_SignOutOthers = false;   // al entrar, cerrar primero la cuenta en los demas equipos (contrasena olvidada)

    Task m_Task = Task::None;
    TaskState m_TaskState = TaskState::Idle;
    TaskStep m_TaskStep = TaskStep::None;
    AuthError m_TaskError = AuthError::None;
    std::shared_ptr<HttpCall> m_TaskCall;
    std::string m_TaskEmail;   // el correo que se esta guardando
    UserInfo m_User;
    bool m_UserLoaded = false;
    OwnProfile m_Profile;
    bool m_ProfileLoaded = false;
};

} // namespace Bazuko::Online
