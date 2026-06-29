using MediaHub.MediaAppData.SqlLite;
using Microsoft.EntityFrameworkCore;
using System.Data.Common;
using System.Net;
using System.Text;

namespace MediaHub.WebServices.MediaApp.DatabaseViews;

/// <summary>
/// Base class for database debug views.
/// </summary>
public abstract class AbstractDatabaseView : HtmlViewAsync
{
    protected readonly IDbContextFactory<MediaHubDbContext> DbFactory;

    protected AbstractDatabaseView(IDbContextFactory<MediaHubDbContext> dbFactory)
    {
        DbFactory = dbFactory;
    }

    protected static string Html(string? value)
    {
        return WebUtility.HtmlEncode(value ?? "");
    }

    protected static string EscapeIdentifier(string identifier)
    {
        return identifier.Replace("\"", "\"\"");
    }

    protected async Task<T> ExecuteReaderAsync<T>(
        string sql,
        CancellationToken ct,
        Func<DbDataReader, CancellationToken, Task<T>> read)
    {
        await using var db =
            await DbFactory.CreateDbContextAsync(ct);

        await using var command =
            db.Database.GetDbConnection().CreateCommand();

        if (command.Connection!.State != System.Data.ConnectionState.Open)
            await command.Connection.OpenAsync(ct);

        command.CommandText = sql;

        await using var reader =
            await command.ExecuteReaderAsync(ct);

        return await read(reader, ct);
    }

    protected async Task<List<string>> GetTableNamesAsync(CancellationToken ct)
    {
        const string sql = """
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
ORDER BY name
""";

        return await ExecuteReaderAsync(
            sql,
            ct,
            async (reader, token) =>
            {
                List<string> tables = new();

                while (await reader.ReadAsync(token))
                    tables.Add(reader.GetString(0));

                return tables;
            });
    }

    protected async Task<bool> TableExistsAsync(string tableName, CancellationToken ct)
    {
        List<string> tables = await GetTableNamesAsync(ct);

        return tables.Any(
            table => string.Equals(
                table,
                tableName,
                StringComparison.OrdinalIgnoreCase));
    }

    protected async Task<string> RenderQueryTableAsync(
        string sql,
        CancellationToken ct,
        bool includeQueryForm = false)
    {
        try
        {
            return await ExecuteReaderAsync(
                sql,
                ct,
                async (reader, token) =>
                    await RenderReaderPageAsync(
                        reader,
                        sql,
                        token,
                        includeQueryForm));
        }
        catch (Exception ex)
        {
            return RenderErrorPage(sql, ex, includeQueryForm);
        }
    }

    protected async Task<string> RenderQueryTableFragmentAsync(
        string sql,
        CancellationToken ct)
    {
        try
        {
            return await ExecuteReaderAsync(
                sql,
                ct,
                RenderReaderTableOnlyAsync);
        }
        catch (Exception ex)
        {
            return RenderErrorBlock(ex);
        }
    }

    protected static async Task<string> RenderReaderPageAsync(
        DbDataReader reader,
        string sql,
        CancellationToken ct,
        bool includeQueryForm = false)
    {
        StringBuilder html = new();

        html.Append(RenderPageStart("Database Viewer"));

        html.Append($$"""
<p><a href="{{DatabaseDebugRoutes.Home}}">Back</a></p>
""");

        html.Append(RenderSqlInputOrPreview(sql, includeQueryForm));
        html.Append(await RenderReaderTableOnlyAsync(reader, ct));
        html.Append(RenderPageEnd());

        return html.ToString();
    }

    protected static async Task<string> RenderReaderTableOnlyAsync(
        DbDataReader reader,
        CancellationToken ct)
    {
        StringBuilder html = new();

        html.Append("""
<table>
<thead>
<tr>
""");

        for (int i = 0; i < reader.FieldCount; i++)
            html.Append($"<th>{Html(reader.GetName(i))}</th>");

        html.Append("""
</tr>
</thead>
<tbody>
""");

        while (await reader.ReadAsync(ct))
        {
            html.Append("<tr>");

            for (int i = 0; i < reader.FieldCount; i++)
            {
                string value =
                    await reader.IsDBNullAsync(i, ct)
                        ? ""
                        : reader.GetValue(i)?.ToString() ?? "";

                html.Append($"<td>{Html(value)}</td>");
            }

            html.Append("</tr>");
        }

        html.Append("""
</tbody>
</table>
""");

        return html.ToString();
    }

    protected static string RenderErrorPage(
        string sql,
        Exception ex,
        bool includeQueryForm = false)
    {
        StringBuilder html = new();

        html.Append(RenderPageStart("Database Viewer - Error"));

        html.Append($$"""
<p><a href="{{DatabaseDebugRoutes.Home}}">Back</a></p>
""");

        html.Append(RenderSqlInputOrPreview(sql, includeQueryForm));

        html.Append("""
<h2>Database Error</h2>
""");

        html.Append(RenderErrorBlock(ex));
        html.Append(RenderPageEnd());

        return html.ToString();
    }

    protected static string RenderSqlInputOrPreview(
        string sql,
        bool includeQueryForm)
    {
        if (includeQueryForm)
        {
            return $$"""
<form method="get" action="{{DatabaseDebugRoutes.Query}}">
<textarea name="sql" rows="8">{{Html(sql)}}</textarea>
<br />
<br />
<button type="submit">Run Query</button>
</form>
<br />
""";
        }

        return $$"""
<pre>{{Html(sql)}}</pre>
<br />
""";
    }

    protected static string RenderErrorBlock(Exception ex)
    {
        return $$"""
<div class="error">
    <strong>{{Html(ex.GetType().Name)}}</strong>
    <pre>{{Html(ex.Message)}}</pre>
</div>
""";
    }

    protected static string RenderPageStart(string title)
    {
        return $$"""
<!DOCTYPE html>
<html>
<head>
    <title>{{Html(title)}}</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 40px; }
        th, td
        {
            border: 1px solid #ccc;
            padding: 6px;
            text-align: left;
            vertical-align: top;
        }
        th { background: #eee; }
        td { max-width: 600px; overflow-wrap: anywhere; }
        textarea { width: 100%; max-width: 1200px; }
        pre { white-space: pre-wrap; }
        a { text-decoration: none; }
        .error
        {
            background: #ffecec;
            border: 1px solid #cc0000;
            padding: 12px;
            color: #900;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>

""";
    }

    protected static string RenderPageEnd()
    {
        return """
</body>
</html>
""";
    }

    protected static bool IsReadOnlySql(string sql)
    {
        string trimmed = sql.TrimStart();

        return trimmed.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("WITH", StringComparison.OrdinalIgnoreCase);
    }
}