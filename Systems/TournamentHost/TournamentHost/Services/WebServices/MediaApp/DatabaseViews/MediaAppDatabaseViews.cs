using MediaHub.MediaAppData.SqlLite;
using Microsoft.EntityFrameworkCore;

namespace MediaHub.WebServices.MediaApp.DatabaseViews;

public static class DatabaseDebugRoutes
{
    public const string Home = "/debug/db";
    public const string Table = "/debug/db/table";
    public const string Query = "/debug/db/query";

    public static string TableUrl(string tableName)
    {
        return $"{Table}?name={Uri.EscapeDataString(tableName)}";
    }

    public static string QueryUrl(string sql)
    {
        return $"{Query}?sql={Uri.EscapeDataString(sql)}";
    }
}

public static class MediaAppDatabaseViews
{
    public static List<View> MakeViews(IDbContextFactory<MediaHubDbContext> dbFactory)
    {
        return
        [
            new DatabaseHomeView(dbFactory),
            new DatabaseTableView(dbFactory),
            new DatabaseQueryView(dbFactory)
        ];
    }
}