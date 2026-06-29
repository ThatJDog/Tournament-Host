namespace MediaHub.ViewerService;

public static class ViewerMessageTypes
{
    public const string Write = "write";
    public const string WriteLine = "writeline";
    public const string Error = "error";
    public const string ErrorLine = "errorline";
    public const string Clear = "clear";
    public const string Exit = "exit";

    // Viewer -> Main
    public const string Input = "input";
    public const string Started = "started";
    public const string Exited = "exited";
}