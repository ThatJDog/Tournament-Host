namespace MediaHub.ViewerService;

public sealed record ViewerMessage(
    string Type,
    string? Message = null,
    Dictionary<string, string>? Args = null,
    string? Id = null
);